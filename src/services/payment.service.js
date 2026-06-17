import crypto from "crypto";
import Razorpay from "razorpay";
import pool from "../config/db.js";
import { Course } from "../models/course.model.js";
import { Enrollment } from "../models/enrollment.model.js";
import { Progress } from "../models/progress.model.js";
import { ApiError } from "../utils/ApiError.js";
import { sendPaymentConfirmation } from "../utils/mail.util.js";
import { newId } from "../utils/id.util.js";

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

// Idempotently ensure an active enrollment (+ progress) exists for a paid user.
// Safe to call repeatedly — only bumps the course counter when a seat is newly
// taken, so retries of /verify never double-count or double-enroll.
async function ensureEnrolled(userId, courseId, enrollmentType) {
  const existing = await Enrollment.findOne({ userId, courseId });
  if (!existing) {
    await Enrollment.create({ userId, courseId, enrolledBy: userId, enrollmentType });
    await Progress.create({ userId, courseId }).catch(() => {}); // progress is non-critical
    await Course.findByIdAndUpdate(courseId, { $inc: { totalStudentsEnrolled: 1 } });
    return true;
  }
  if (!existing.isActive) {
    existing.isActive = true;
    existing.unenrolledAt = null;
    existing.enrollmentType = enrollmentType;
    await existing.save();
    await Course.findByIdAndUpdate(courseId, { $inc: { totalStudentsEnrolled: 1 } });
    return true;
  }
  return false;
}

export const createOrderService = async ({ userId, courseId, enrollmentType = "self-paced" }) => {
  if (!courseId) throw new ApiError(400, "courseId is required");
  if (!["self-paced", "classroom", "live"].includes(enrollmentType)) {
    throw new ApiError(400, "enrollmentType must be 'self-paced', 'classroom' or 'live'");
  }

  const course = await Course.findById(courseId).select("title priceOnline priceOffline priceLive price isPublished modes");
  if (!course) throw new ApiError(404, "Course not found");
  if (!course.isPublished) throw new ApiError(403, "Course is not available");

  if (Array.isArray(course.modes) && course.modes.length && !course.modes.includes(enrollmentType)) {
    throw new ApiError(400, `This course is not available as ${enrollmentType}.`);
  }

  // Price fields: priceOnline = self-paced, priceOffline = classroom, priceLive = live.
  const priceINR = enrollmentType === "classroom"
    ? (course.priceOffline || 0)
    : enrollmentType === "live"
      ? (course.priceLive || 0)
      : (course.priceOnline || course.price || 0);
  if (priceINR <= 0) throw new ApiError(400, "Course price is not set for this enrollment type");

  const existing = await Enrollment.findOne({ userId, courseId, isActive: true });
  if (existing) throw new ApiError(409, "You are already enrolled in this course");

  const existingPending = await pool.query(
    "SELECT * FROM payments WHERE user_id = $1 AND course_id = $2 AND enrollment_type = $3 AND status = 'pending' ORDER BY created_at DESC LIMIT 1",
    [userId, courseId, enrollmentType]
  );
  if (existingPending.rows.length > 0) {
    const p = existingPending.rows[0];
    return {
      reused: true,
      data: {
        orderId: p.razorpay_order_id,
        amount: p.amount,
        currency: p.currency,
        keyId: process.env.RAZORPAY_KEY_ID,
        courseName: p.course_title,
        enrollmentType: p.enrollment_type,
      },
    };
  }

  let rzpOrder;
  try {
    rzpOrder = await getRazorpay().orders.create({
      amount: priceINR * 100,
      currency: "INR",
      // Razorpay caps receipt at 40 chars. A UUID userId would overflow it, so use
      // a short timestamp + random token; userId/course are kept in notes below.
      receipt: `rcpt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      notes: { courseId, enrollmentType, userId },
    });
  } catch (e) {
    // Razorpay SDK errors carry the reason in e.error.description (not e.message),
    // so surface it instead of a blank 400.
    const desc = e?.error?.description || e?.message || "Payment gateway error";
    throw new ApiError(e?.statusCode || 502, `Payment gateway: ${desc}`);
  }

  await pool.query(
    `INSERT INTO payments (id, user_id, course_id, course_title, enrollment_type, amount, currency, razorpay_order_id, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'INR', $7, 'pending')`,
    [newId(), userId, courseId, course.title, enrollmentType, rzpOrder.amount, rzpOrder.id]
  );

  return {
    reused: false,
    data: {
      orderId: rzpOrder.id,
      amount: rzpOrder.amount,
      currency: rzpOrder.currency,
      keyId: process.env.RAZORPAY_KEY_ID,
      courseName: course.title,
      enrollmentType,
    },
  };
};

export const verifyPaymentService = async ({ userId, razorpay_order_id, razorpay_payment_id, razorpay_signature }) => {
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    throw new ApiError(400, "razorpay_order_id, razorpay_payment_id and razorpay_signature are required");
  }

  const hmac = crypto.createHmac("sha256", process.env.RAZORPAY_KEY_SECRET);
  hmac.update(`${razorpay_order_id}|${razorpay_payment_id}`);
  const expectedSignature = hmac.digest("hex");

  if (expectedSignature !== razorpay_signature) {
    await pool.query(
      "UPDATE payments SET status = 'failed', updated_at = NOW() WHERE razorpay_order_id = $1",
      [razorpay_order_id]
    );
    throw new ApiError(400, "Payment verification failed — invalid signature");
  }

  const result = await pool.query(
    "SELECT * FROM payments WHERE razorpay_order_id = $1 AND user_id = $2",
    [razorpay_order_id, userId]
  );
  if (result.rows.length === 0) throw new ApiError(404, "Payment record not found");
  const payment = result.rows[0];

  // Idempotent: if this order was already marked paid, make sure the enrollment
  // actually exists (self-heal a prior half-completed verify) and return.
  if (payment.status === "paid") {
    await ensureEnrolled(userId, payment.course_id, payment.enrollment_type);
    return { alreadyEnrolled: true, courseId: payment.course_id };
  }

  // Mark paid + record commission atomically in Postgres. If anything here
  // fails, nothing is committed and the client can safely retry /verify.
  const client = await pool.connect();
  let user;
  try {
    await client.query("BEGIN");

    await client.query(
      `UPDATE payments
       SET status = 'paid', razorpay_payment_id = $1, razorpay_signature = $2, paid_at = NOW(), updated_at = NOW()
       WHERE razorpay_order_id = $3`,
      [razorpay_payment_id, razorpay_signature, razorpay_order_id]
    );

    const userResult = await client.query(
      "SELECT full_name, email, referred_by FROM users WHERE id = $1",
      [userId]
    );
    user = userResult.rows[0];

    // Affiliate commission for referred users — once per payment (guarded by the
    // unique-ish payment_id; a retry can't reach here since status is now paid).
    if (user?.referred_by) {
      const affRes = await client.query(
        "SELECT user_id, commission_type, commission_value FROM affiliates WHERE user_id = $1 AND status = 'active'",
        [user.referred_by]
      );
      if (affRes.rows.length > 0) {
        const aff = affRes.rows[0];
        const saleAmount = payment.amount;
        const commissionAmount =
          aff.commission_type === "flat"
            ? Math.round(Number(aff.commission_value) * 100)
            : Math.round((saleAmount * Number(aff.commission_value)) / 100);
        if (commissionAmount > 0) {
          await client.query(
            `INSERT INTO commissions
               (id, affiliate_user_id, referred_user_id, payment_id, course_title, sale_amount, commission_amount, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')`,
            [newId(), aff.user_id, userId, payment.id, payment.course_title, saleAmount, commissionAmount]
          );
        }
      }
    }

    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }

  // Enrollment lives in Mongo (separate store) — idempotent so a retry reconciles.
  await ensureEnrolled(userId, payment.course_id, payment.enrollment_type);

  sendPaymentConfirmation({
    name: user.full_name,
    email: user.email,
    courseName: payment.course_title,
    enrollmentType: payment.enrollment_type,
    amountINR: payment.amount / 100,
    paymentId: razorpay_payment_id,
  }).catch(() => {});

  return {
    alreadyEnrolled: false,
    courseId: payment.course_id,
    paymentId: razorpay_payment_id,
    enrollmentType: payment.enrollment_type,
  };
};

export const getPaymentHistoryService = async ({ page = 1, limit = 20, status }) => {
  const pageNum = Number(page);
  const limitNum = Number(limit);

  const conditions = [];
  const params = [];
  if (status) {
    params.push(status);
    conditions.push(`p.status = $${params.length}`);
  }
  const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";

  const countResult = await pool.query(`SELECT COUNT(*) FROM payments p ${where}`, params);
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

  const revenueResult = await pool.query(
    "SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE status = 'paid'"
  );
  const totalRevenue = Number(revenueResult.rows[0].total) / 100;

  return { payments: dataResult.rows, total, page: pageNum, limit: limitNum, totalRevenue };
};

export const getMyPaymentsService = async (userId) => {
  const result = await pool.query(
    `SELECT id, course_id, course_title, enrollment_type, amount, currency,
            razorpay_order_id, razorpay_payment_id, status, paid_at, created_at
     FROM payments
     WHERE user_id = $1
     ORDER BY created_at DESC`,
    [userId]
  );
  return result.rows;
};
