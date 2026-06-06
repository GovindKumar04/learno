import crypto from "crypto";
import Razorpay from "razorpay";
import pool from "../config/db.js";
import { Course } from "../models/course.model.js";
import { Enrollment } from "../models/enrollment.model.js";
import { Progress } from "../models/progress.model.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { sendPaymentConfirmation } from "../utils/mail.util.js";

// Lazy — created on first use so missing keys don't crash the server at startup
let _razorpay = null;
const getRazorpay = () => {
  if (!_razorpay) {
    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
      throw new ApiError(503, "Payment gateway is not configured. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to .env");
    }
    _razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });
  }
  return _razorpay;
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /payments/create-order
// Student initiates payment for a course
// ─────────────────────────────────────────────────────────────────────────────
const createOrder = asyncHandler(async (req, res) => {
  const { courseId, enrollmentType = "online" } = req.body;
  const userId = req.user.id;

  if (!courseId) throw new ApiError(400, "courseId is required");
  if (!["online", "offline"].includes(enrollmentType)) {
    throw new ApiError(400, "enrollmentType must be 'online' or 'offline'");
  }

  const course = await Course.findById(courseId).select("title priceOnline priceOffline price isPublished modes");
  if (!course) throw new ApiError(404, "Course not found");
  if (!course.isPublished) throw new ApiError(403, "Course is not available");

  // The course must actually be offered in the requested mode.
  if (Array.isArray(course.modes) && course.modes.length && !course.modes.includes(enrollmentType)) {
    throw new ApiError(400, `This course is not available ${enrollmentType}.`);
  }

  // Determine price in paise
  const priceINR = enrollmentType === "offline"
    ? (course.priceOffline || 0)
    : (course.priceOnline || course.price || 0);

  if (priceINR <= 0) throw new ApiError(400, "Course price is not set for this enrollment type");

  // Check if already enrolled and active
  const existing = await Enrollment.findOne({ userId, courseId, isActive: true });
  if (existing) throw new ApiError(409, "You are already enrolled in this course");

  // Check for an existing pending order to avoid duplicates.
  // Scoped by enrollmentType so switching online↔offline doesn't return a
  // stale order priced for the other mode.
  const existingPending = await pool.query(
    "SELECT * FROM payments WHERE user_id = $1 AND course_id = $2 AND enrollment_type = $3 AND status = 'pending' ORDER BY created_at DESC LIMIT 1",
    [userId, courseId, enrollmentType]
  );
  if (existingPending.rows.length > 0) {
    const p = existingPending.rows[0];
    return res.json(new ApiResponse(200, {
      orderId: p.razorpay_order_id,
      amount: p.amount,
      currency: p.currency,
      keyId: process.env.RAZORPAY_KEY_ID,
      courseName: p.course_title,
      enrollmentType: p.enrollment_type,
    }, "Existing pending order returned"));
  }

  // Create Razorpay order
  const rzpOrder = await getRazorpay().orders.create({
    amount: priceINR * 100, // paise
    currency: "INR",
    receipt: `rcpt_${userId}_${Date.now()}`,
    notes: { courseId, enrollmentType, userId },
  });

  // Store in PostgreSQL
  await pool.query(
    `INSERT INTO payments (user_id, course_id, course_title, enrollment_type, amount, currency, razorpay_order_id, status)
     VALUES ($1, $2, $3, $4, $5, 'INR', $6, 'pending')`,
    [userId, courseId, course.title, enrollmentType, rzpOrder.amount, rzpOrder.id]
  );

  return res.json(new ApiResponse(200, {
    orderId: rzpOrder.id,
    amount: rzpOrder.amount,
    currency: rzpOrder.currency,
    keyId: process.env.RAZORPAY_KEY_ID,
    courseName: course.title,
    enrollmentType,
  }));
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /payments/verify
// Verifies Razorpay signature, enrolls student, sends email
// ─────────────────────────────────────────────────────────────────────────────
const verifyPayment = asyncHandler(async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
  const userId = req.user.id;

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    throw new ApiError(400, "razorpay_order_id, razorpay_payment_id and razorpay_signature are required");
  }

  // Verify HMAC-SHA256 signature
  const hmac = crypto.createHmac("sha256", process.env.RAZORPAY_KEY_SECRET);
  hmac.update(`${razorpay_order_id}|${razorpay_payment_id}`);
  const expectedSignature = hmac.digest("hex");

  if (expectedSignature !== razorpay_signature) {
    // Mark payment as failed
    await pool.query(
      "UPDATE payments SET status = 'failed', updated_at = NOW() WHERE razorpay_order_id = $1",
      [razorpay_order_id]
    );
    throw new ApiError(400, "Payment verification failed — invalid signature");
  }

  // Fetch payment record
  const result = await pool.query(
    "SELECT * FROM payments WHERE razorpay_order_id = $1 AND user_id = $2",
    [razorpay_order_id, userId]
  );
  if (result.rows.length === 0) throw new ApiError(404, "Payment record not found");
  const payment = result.rows[0];

  // Idempotent — already processed
  if (payment.status === "paid") {
    return res.json(new ApiResponse(200, { courseId: payment.course_id }, "Already enrolled"));
  }

  // Update payment to paid
  await pool.query(
    `UPDATE payments
     SET status = 'paid', razorpay_payment_id = $1, razorpay_signature = $2, paid_at = NOW(), updated_at = NOW()
     WHERE razorpay_order_id = $3`,
    [razorpay_payment_id, razorpay_signature, razorpay_order_id]
  );

  // Enroll student in MongoDB
  const existing = await Enrollment.findOne({ userId, courseId: payment.course_id });
  if (!existing) {
    await Enrollment.create({
      userId,
      courseId: payment.course_id,
      enrolledBy: userId,
      enrollmentType: payment.enrollment_type,
    });
    await Progress.create({ userId, courseId: payment.course_id });
  } else if (!existing.isActive) {
    existing.isActive = true;
    existing.unenrolledAt = null;
    existing.enrollmentType = payment.enrollment_type;
    await existing.save();
  }

  // Increment course enrollment counter
  await Course.findByIdAndUpdate(payment.course_id, { $inc: { totalStudentsEnrolled: 1 } });

  // Fetch user details for email + affiliate attribution
  const userResult = await pool.query(
    "SELECT full_name, email, referred_by FROM users WHERE id = $1",
    [userId]
  );
  const user = userResult.rows[0];

  // ── Affiliate commission ────────────────────────────────────────────────
  // Every purchase by a referred user earns their affiliate a commission.
  if (user?.referred_by) {
    try {
      const affRes = await pool.query(
        "SELECT user_id, commission_type, commission_value FROM affiliates WHERE user_id = $1 AND status = 'active'",
        [user.referred_by]
      );
      if (affRes.rows.length > 0) {
        const aff = affRes.rows[0];
        const saleAmount = payment.amount; // paise
        const commissionAmount =
          aff.commission_type === "flat"
            ? Math.round(Number(aff.commission_value) * 100)          // flat ₹ → paise
            : Math.round((saleAmount * Number(aff.commission_value)) / 100); // percent of sale

        if (commissionAmount > 0) {
          await pool.query(
            `INSERT INTO commissions
               (affiliate_user_id, referred_user_id, payment_id, course_title, sale_amount, commission_amount, status)
             VALUES ($1, $2, $3, $4, $5, $6, 'pending')`,
            [aff.user_id, userId, payment.id, payment.course_title, saleAmount, commissionAmount]
          );
        }
      }
    } catch (e) {
      // Never let commission failure break the payment flow
      console.error("Commission recording failed:", e.message);
    }
  }

  // Send confirmation email (non-blocking)
  sendPaymentConfirmation({
    name: user.full_name,
    email: user.email,
    courseName: payment.course_title,
    enrollmentType: payment.enrollment_type,
    amountINR: payment.amount / 100,
    paymentId: razorpay_payment_id,
  }).catch(() => {});

  return res.json(new ApiResponse(200, {
    courseId: payment.course_id,
    paymentId: razorpay_payment_id,
    enrollmentType: payment.enrollment_type,
  }, "Payment verified and enrolled successfully"));
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /payments/history   (admin)
// Full payment history across all students
// ─────────────────────────────────────────────────────────────────────────────
const getPaymentHistory = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, status } = req.query;
  const pageNum = Number(page);
  const limitNum = Number(limit);

  const conditions = [];
  const params = [];

  if (status) {
    params.push(status);
    conditions.push(`p.status = $${params.length}`);
  }

  const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";

  const countResult = await pool.query(
    `SELECT COUNT(*) FROM payments p ${where}`,
    params
  );
  const total = Number(countResult.rows[0].count);

  params.push(limitNum, (pageNum - 1) * limitNum);
  const dataResult = await pool.query(
    `SELECT p.id, p.user_id, p.course_id, p.course_title, p.enrollment_type,
            p.amount, p.currency, p.razorpay_order_id, p.razorpay_payment_id,
            p.status, p.paid_at, p.created_at,
            u.full_name, u.email, u.phone
     FROM payments p
     JOIN users u ON u.id = p.user_id
     ${where}
     ORDER BY p.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  // Total collected
  const revenueResult = await pool.query(
    "SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE status = 'paid'"
  );
  const totalRevenue = Number(revenueResult.rows[0].total) / 100;

  return res.json(new ApiResponse(200, {
    payments: dataResult.rows,
    total,
    page: pageNum,
    limit: limitNum,
    totalRevenue,
  }));
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /payments/my   (student)
// Student's own payment history
// ─────────────────────────────────────────────────────────────────────────────
const getMyPayments = asyncHandler(async (req, res) => {
  const result = await pool.query(
    `SELECT id, course_id, course_title, enrollment_type, amount, currency,
            razorpay_order_id, razorpay_payment_id, status, paid_at, created_at
     FROM payments
     WHERE user_id = $1
     ORDER BY created_at DESC`,
    [req.user.id]
  );
  return res.json(new ApiResponse(200, result.rows));
});

export { createOrder, verifyPayment, getPaymentHistory, getMyPayments };
