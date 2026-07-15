import crypto from "crypto";
import Razorpay from "razorpay";
import { Course } from "../models/course.model.js";
import { Enrollment } from "../models/enrollment.model.js";
import { Progress } from "../models/progress.model.js";
import { Payment } from "../models/payment.model.js";
import { Commission } from "../models/commission.model.js";
import { Affiliate } from "../models/affiliate.model.js";
import { User } from "../models/user.model.js";
import { ApiError } from "../utils/ApiError.js";
import { sendPaymentConfirmation } from "../utils/mail.util.js";
import { sendCourseWelcomeWhatsApp } from "../utils/whatsapp.util.js";
import { runInTransaction } from "../utils/transaction.util.js";
import { buildUserMap } from "../utils/userQuery.util.js";

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

  const course = await Course.findById(courseId).select("title priceOnline priceOffline priceLive price discountPercent isPublished modes");
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

  // Apply the course-level discount to get the amount actually charged. Computed
  // server-side so a tampered client can't alter it. Capped 0–90; rounded to
  // whole rupees. The original priceINR stays the strike-through reference.
  const discount = Math.min(Math.max(Number(course.discountPercent) || 0, 0), 90);
  const payableINR = discount > 0 ? Math.round(priceINR * (1 - discount / 100)) : priceINR;

  const existing = await Enrollment.findOne({ userId, courseId, isActive: true });
  if (existing) throw new ApiError(409, "You are already enrolled in this course");

  const existingPending = await Payment.findOne({
    user_id: userId, course_id: courseId, enrollment_type: enrollmentType, status: "pending",
  }).sort({ created_at: -1 }).lean();
  if (existingPending) {
    return {
      reused: true,
      data: {
        orderId: existingPending.razorpay_order_id,
        amount: existingPending.amount,
        currency: existingPending.currency,
        keyId: process.env.RAZORPAY_KEY_ID,
        courseName: existingPending.course_title,
        enrollmentType: existingPending.enrollment_type,
      },
    };
  }

  let rzpOrder;
  try {
    rzpOrder = await getRazorpay().orders.create({
      amount: payableINR * 100,
      currency: "INR",
      // Razorpay caps receipt at 40 chars. A UUID userId would overflow it, so use
      // a short timestamp + random token; userId/course are kept in notes below.
      receipt: `rcpt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      notes: { courseId, enrollmentType, userId },
    });
  } catch (e) {
    const desc = e?.error?.description || e?.message || "Payment gateway error";
    throw new ApiError(e?.statusCode || 502, `Payment gateway: ${desc}`);
  }

  await Payment.create({
    user_id: userId,
    course_id: courseId,
    course_title: course.title,
    enrollment_type: enrollmentType,
    amount: rzpOrder.amount,
    currency: "INR",
    razorpay_order_id: rzpOrder.id,
    status: "pending",
  });

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
    await Payment.updateOne({ razorpay_order_id }, { status: "failed" });
    throw new ApiError(400, "Payment verification failed — invalid signature");
  }

  const payment = await Payment.findOne({ razorpay_order_id, user_id: userId });
  if (!payment) throw new ApiError(404, "Payment record not found");

  // Idempotent: if this order was already marked paid, make sure the enrollment
  // actually exists (self-heal a prior half-completed verify) and return.
  if (payment.status === "paid") {
    await ensureEnrolled(userId, payment.course_id, payment.enrollment_type);
    return { alreadyEnrolled: true, courseId: payment.course_id };
  }

  // Mark paid + record commission. On a replica set / mongos this commits
  // atomically in a transaction; on a standalone mongod (no transactions) it
  // falls back to sequential writes. Either way /verify is idempotent, so a
  // retry reconciles a partially-applied state.
  const user = await runInTransaction(async (session) => {
    await Payment.updateOne(
      { razorpay_order_id },
      { status: "paid", razorpay_payment_id, razorpay_signature, paid_at: new Date() },
      { session }
    );

    const u = await User.findById(userId).select("full_name email phone referred_by").session(session).lean();

    // Affiliate commission for referred users — once per payment.
    if (u?.referred_by) {
      const aff = await Affiliate.findOne({ user_id: u.referred_by, status: "active" })
        .select("user_id commission_type commission_value").session(session).lean();
      if (aff) {
        const saleAmount = payment.amount;
        const commissionAmount =
          aff.commission_type === "flat"
            ? Math.round(Number(aff.commission_value) * 100)
            : Math.round((saleAmount * Number(aff.commission_value)) / 100);
        if (commissionAmount > 0) {
          await Commission.create([{
            affiliate_user_id: aff.user_id,
            referred_user_id: userId,
            payment_id: payment._id,
            course_title: payment.course_title,
            sale_amount: saleAmount,
            commission_amount: commissionAmount,
            status: "pending",
          }], { session });
        }
      }
    }
    return u;
  });

  // Enrollment is idempotent so a retry reconciles.
  await ensureEnrolled(userId, payment.course_id, payment.enrollment_type);

  sendPaymentConfirmation({
    name: user.full_name,
    email: user.email,
    courseName: payment.course_title,
    enrollmentType: payment.enrollment_type,
    amountINR: payment.amount / 100,
    paymentId: razorpay_payment_id,
  }).catch(() => {});

  // Welcome + thanks-for-enrolling WhatsApp greeting. Fire-and-forget (it's
  // already non-blocking internally) so a WhatsApp outage never fails /verify.
  sendCourseWelcomeWhatsApp({
    name: user.full_name,
    phone: user.phone,
    courseName: payment.course_title,
  });

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

  const filter = {};
  if (status) filter.status = status;

  const [total, docs, revenueAgg] = await Promise.all([
    Payment.countDocuments(filter),
    Payment.find(filter).sort({ created_at: -1 }).skip((pageNum - 1) * limitNum).limit(limitNum).lean(),
    Payment.aggregate([{ $match: { status: "paid" } }, { $group: { _id: null, total: { $sum: "$amount" } } }]),
  ]);

  const userMap = await buildUserMap(
    [...new Set(docs.map((p) => p.user_id))],
    "full_name email phone"
  );

  const payments = docs.map((p) => {
    const u = userMap[p.user_id] || {};
    return {
      id: p._id,
      user_id: p.user_id,
      course_id: p.course_id,
      course_title: p.course_title,
      enrollment_type: p.enrollment_type,
      amount: p.amount,
      currency: p.currency,
      razorpay_order_id: p.razorpay_order_id,
      razorpay_payment_id: p.razorpay_payment_id,
      status: p.status,
      paid_at: p.paid_at,
      created_at: p.created_at,
      full_name: u.full_name || null,
      email: u.email || null,
      phone: u.phone || null,
    };
  });

  const totalRevenue = (revenueAgg[0]?.total || 0) / 100;

  return { payments, total, page: pageNum, limit: limitNum, totalRevenue };
};

export const getMyPaymentsService = async (userId) => {
  const docs = await Payment.find({ user_id: userId }).sort({ created_at: -1 }).lean();
  return docs.map((p) => ({
    id: p._id,
    course_id: p.course_id,
    course_title: p.course_title,
    enrollment_type: p.enrollment_type,
    amount: p.amount,
    currency: p.currency,
    razorpay_order_id: p.razorpay_order_id,
    razorpay_payment_id: p.razorpay_payment_id,
    status: p.status,
    paid_at: p.paid_at,
    created_at: p.created_at,
  }));
};
