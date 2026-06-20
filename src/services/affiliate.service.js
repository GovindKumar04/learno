import crypto from "crypto";
import bcrypt from "bcrypt";
import mongoose from "mongoose";
import { User } from "../models/user.model.js";
import { Affiliate } from "../models/affiliate.model.js";
import { Commission } from "../models/commission.model.js";
import { AffiliateApplication } from "../models/affiliateApplication.model.js";
import { AffiliateResource } from "../models/affiliateResource.model.js";
import { ApiError } from "../utils/ApiError.js";
import { sendAffiliateApprovalMail, sendAffiliateRejectionMail } from "../utils/mail.util.js";
import { verifyAdminPassword, escapeRegex } from "../utils/deleteGuard.util.js";
import { buildUserMap } from "../utils/userQuery.util.js";

const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:5173";

const generateCode = () => `FSA-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
const generatePassword = () =>
  crypto.randomBytes(9).toString("base64").replace(/[^a-zA-Z0-9]/g, "").slice(0, 10) + "9!";

// Case-insensitive exact-email matcher (replaces SQL lower(email) = lower($1)).
const emailEq = (email) => new RegExp(`^${escapeRegex(String(email).trim())}$`, "i");

// Public application to join the affiliate program (no account created here).
export const applyAffiliateService = async ({ full_name, email, phone, bio, social_links: rawLinks }) => {
  if (!full_name?.trim() || !email?.trim()) throw new ApiError(400, "Full name and email are required");
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRe.test(email.trim())) throw new ApiError(400, "Please provide a valid email");

  const raw = Array.isArray(rawLinks) ? rawLinks : [];
  const social_links = raw
    .map((s) => ({ platform: String(s?.platform || "").trim(), url: String(s?.url || "").trim() }))
    .filter((s) => s.url);

  // Reject if an affiliate account already exists for this email.
  const existingUser = await User.findOne({ email: emailEq(email) }).select("_id").lean();
  if (existingUser) {
    const existingAff = await Affiliate.findOne({ user_id: existingUser._id }).select("_id").lean();
    if (existingAff) throw new ApiError(409, "An affiliate account already exists for this email");
  }

  try {
    const app = await AffiliateApplication.create({
      full_name: full_name.trim(),
      email: email.trim(),
      phone: phone?.trim() || null,
      bio: bio?.trim() || null,
      social_links,
    });
    return { id: app._id, full_name: app.full_name, email: app.email, status: app.status, created_at: app.created_at };
  } catch (e) {
    if (e.code === 11000) throw new ApiError(409, "You already have a pending application with this email");
    throw e;
  }
};

export const getMyAffiliateService = async (userId) => {
  const affiliate = await Affiliate.findOne({ user_id: userId }).lean();
  if (!affiliate) return { isAffiliate: false };

  const [refCount, totalsAgg, commissionDocs] = await Promise.all([
    User.countDocuments({ referred_by: userId }),
    Commission.aggregate([
      { $match: { affiliate_user_id: userId } },
      { $group: {
          _id: null,
          total:    { $sum: "$commission_amount" },
          pending:  { $sum: { $cond: [{ $eq: ["$status", "pending"] }, "$commission_amount", 0] } },
          approved: { $sum: { $cond: [{ $eq: ["$status", "approved"] }, "$commission_amount", 0] } },
          paid:     { $sum: { $cond: [{ $eq: ["$status", "paid"] }, "$commission_amount", 0] } },
          sales:    { $sum: 1 },
      } },
    ]),
    Commission.find({ affiliate_user_id: userId }).sort({ created_at: -1 }).limit(50).lean(),
  ]);

  const t = totalsAgg[0] || { total: 0, pending: 0, approved: 0, paid: 0, sales: 0 };

  return {
    isAffiliate: true,
    code: affiliate.code,
    referralLink: `${CLIENT_URL}/?ref=${affiliate.code}`,
    commissionType: affiliate.commission_type,
    commissionValue: Number(affiliate.commission_value),
    status: affiliate.status,
    clicks: affiliate.clicks,
    stats: {
      referredUsers: refCount,
      totalSales: Number(t.sales),
      totalEarned: Number(t.total) / 100,
      pending: Number(t.pending) / 100,
      approved: Number(t.approved) / 100,
      paid: Number(t.paid) / 100,
    },
    commissions: commissionDocs.map((c) => ({
      id: c._id,
      course_title: c.course_title,
      status: c.status,
      created_at: c.created_at,
      paid_at: c.paid_at,
      sale_amount: c.sale_amount / 100,
      commission_amount: c.commission_amount / 100,
    })),
  };
};

export const trackClickService = async (code) => {
  await Affiliate.updateOne({ code, status: "active" }, { $inc: { clicks: 1 } });
};

export const getApplicationsService = async ({ status }) => {
  const filter = status ? { status } : {};
  const apps = await AffiliateApplication.find(filter).lean();

  // pending first, then approved, then rejected; newest within each group.
  const rank = { pending: 0, approved: 1, rejected: 2 };
  apps.sort((a, b) =>
    (rank[a.status] ?? 3) - (rank[b.status] ?? 3) ||
    new Date(b.created_at) - new Date(a.created_at)
  );

  const applications = apps.map((a) => ({
    id: a._id,
    full_name: a.full_name,
    email: a.email,
    phone: a.phone,
    bio: a.bio,
    social_links: a.social_links,
    status: a.status,
    review_note: a.review_note,
    user_id: a.user_id,
    reviewed_at: a.reviewed_at,
    created_at: a.created_at,
  }));

  const countsAgg = await AffiliateApplication.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]);
  const counts = { pending: 0, approved: 0, rejected: 0 };
  countsAgg.forEach((r) => { counts[r._id] = r.count; });

  return { applications, counts };
};

// Approve (→ create affiliate-role user + record + email) or reject an application.
export const reviewApplicationService = async ({ id, action, review_note }) => {
  if (!["approve", "reject"].includes(action)) throw new ApiError(400, "action must be 'approve' or 'reject'");

  const application = await AffiliateApplication.findById(id).lean();
  if (!application) throw new ApiError(404, "Application not found");
  if (application.status !== "pending") throw new ApiError(409, `Application already ${application.status}`);

  if (action === "reject") {
    const upd = await AffiliateApplication.findByIdAndUpdate(
      id,
      { status: "rejected", review_note: review_note?.trim() || null, reviewed_at: new Date() },
      { new: true }
    ).lean();
    sendAffiliateRejectionMail({ name: application.full_name, email: application.email, note: review_note?.trim() }).catch(() => {});
    return { action: "reject", payload: { ...upd, id: upd._id } };
  }

  // Approve
  const existingUser = await User.findOne({ email: emailEq(application.email) }).select("_id").lean();
  if (existingUser) {
    throw new ApiError(409, "A user with this email already exists — resolve manually before approving");
  }

  const tempPassword = generatePassword();
  const hashed = await bcrypt.hash(tempPassword, 10);

  const session = await mongoose.startSession();
  let payload;
  try {
    await session.withTransaction(async () => {
      const [user] = await User.create([{
        full_name: application.full_name,
        email: application.email,
        password: hashed,
        role: "affiliate",
        phone: application.phone || "N/A",
        location: "Not specified",
      }], { session });
      const userId = user._id;

      let code = null;
      for (let i = 0; i < 5; i++) {
        const candidate = generateCode();
        const clash = await Affiliate.findOne({ code: candidate }).select("_id").session(session).lean();
        if (!clash) { code = candidate; break; }
      }
      if (!code) throw new ApiError(500, "Could not generate a referral code, please retry");

      await Affiliate.create([{
        user_id: userId,
        code,
        bio: application.bio,
        social_links: application.social_links || [],
      }], { session });

      await AffiliateApplication.updateOne(
        { _id: id },
        { status: "approved", user_id: userId, reviewed_at: new Date() },
        { session }
      );

      payload = { userId, code, email: application.email };
    });
  } finally {
    await session.endSession();
  }

  sendAffiliateApprovalMail({ name: application.full_name, email: application.email, tempPassword, code: payload.code }).catch(() => {});
  return { action: "approve", payload };
};

export const getAllAffiliatesService = async () => {
  const affiliates = await Affiliate.find({}).sort({ created_at: -1 }).lean();

  const userMap = await buildUserMap(
    [...new Set(affiliates.map((a) => a.user_id))],
    "full_name email phone"
  );

  // Referred-user counts grouped by referrer.
  const refAgg = await User.aggregate([
    { $match: { referred_by: { $ne: null } } },
    { $group: { _id: "$referred_by", count: { $sum: 1 } } },
  ]);
  const refMap = {};
  refAgg.forEach((r) => { refMap[r._id] = r.count; });

  // Commission totals grouped by affiliate.
  const commAgg = await Commission.aggregate([
    { $group: {
        _id: "$affiliate_user_id",
        total:  { $sum: "$commission_amount" },
        unpaid: { $sum: { $cond: [{ $ne: ["$status", "paid"] }, "$commission_amount", 0] } },
    } },
  ]);
  const commMap = {};
  commAgg.forEach((c) => { commMap[c._id] = c; });

  const list = affiliates.map((a) => {
    const u = userMap[a.user_id] || {};
    const c = commMap[a.user_id] || { total: 0, unpaid: 0 };
    return {
      id: a._id,
      user_id: a.user_id,
      code: a.code,
      commission_type: a.commission_type,
      commission_value: Number(a.commission_value),
      status: a.status,
      clicks: a.clicks,
      created_at: a.created_at,
      full_name: u.full_name || null,
      email: u.email || null,
      phone: u.phone || null,
      referred_users: refMap[a.user_id] || 0,
      total_earned: Number(c.total) / 100,
      unpaid: Number(c.unpaid) / 100,
    };
  });

  const sumAgg = await Commission.aggregate([
    { $group: {
        _id: null,
        total: { $sum: "$commission_amount" },
        paid:  { $sum: { $cond: [{ $eq: ["$status", "paid"] }, "$commission_amount", 0] } },
    } },
  ]);
  const totalAffiliates = await Affiliate.countDocuments();
  const s = sumAgg[0] || { total: 0, paid: 0 };

  return {
    affiliates: list,
    summary: {
      totalAffiliates,
      totalCommission: Number(s.total) / 100,
      paid: Number(s.paid) / 100,
      unpaid: Number(s.total - s.paid) / 100,
    },
  };
};

export const updateAffiliateService = async ({ userId, commission_type, commission_value, status }) => {
  if (commission_type && !["percent", "flat"].includes(commission_type)) {
    throw new ApiError(400, "commission_type must be 'percent' or 'flat'");
  }
  if (status && !["active", "suspended"].includes(status)) {
    throw new ApiError(400, "status must be 'active' or 'suspended'");
  }

  const update = {};
  if (commission_type) update.commission_type = commission_type;
  if (commission_value !== undefined) update.commission_value = Number(commission_value);
  if (status) update.status = status;

  const aff = await Affiliate.findOneAndUpdate({ user_id: userId }, update, { new: true }).lean();
  if (!aff) throw new ApiError(404, "Affiliate not found");
  return { ...aff, id: aff._id };
};

export const getCommissionsService = async ({ status, page = 1, limit = 30 }) => {
  const pageNum = Number(page);
  const limitNum = Number(limit);

  const filter = status ? { status } : {};

  const [total, docs] = await Promise.all([
    Commission.countDocuments(filter),
    Commission.find(filter).sort({ created_at: -1 }).skip((pageNum - 1) * limitNum).limit(limitNum).lean(),
  ]);

  const userMap = await buildUserMap(
    [...new Set(docs.flatMap((c) => [c.affiliate_user_id, c.referred_user_id]))],
    "full_name email"
  );

  const commissions = docs.map((c) => {
    const af = userMap[c.affiliate_user_id] || {};
    const ru = userMap[c.referred_user_id] || {};
    return {
      id: c._id,
      course_title: c.course_title,
      sale_amount: c.sale_amount / 100,
      commission_amount: c.commission_amount / 100,
      status: c.status,
      created_at: c.created_at,
      paid_at: c.paid_at,
      affiliate_name: af.full_name || null,
      affiliate_email: af.email || null,
      referred_name: ru.full_name || null,
    };
  });

  return { commissions, total, page: pageNum, limit: limitNum };
};

export const updateCommissionStatusService = async ({ id, status }) => {
  if (!["pending", "approved", "paid"].includes(status)) {
    throw new ApiError(400, "status must be pending, approved or paid");
  }
  const update = { status, paid_at: status === "paid" ? new Date() : null };
  const c = await Commission.findByIdAndUpdate(id, update, { new: true }).lean();
  if (!c) throw new ApiError(404, "Commission not found");
  return { ...c, id: c._id };
};

export const getResourcesService = async (user) => {
  const filter = user.role === "admin" ? {} : { is_active: true };
  const rows = await AffiliateResource.find(filter).sort({ created_at: -1 }).lean();
  return rows.map((r) => ({ ...r, id: r._id }));
};

export const createResourceService = async ({ title, description, url }) => {
  if (!title?.trim() || !url?.trim()) throw new ApiError(400, "Title and URL are required");
  const r = await AffiliateResource.create({
    title: title.trim(),
    description: description?.trim() || null,
    url: url.trim(),
  });
  const o = r.toObject();
  return { ...o, id: o._id };
};

export const updateResourceService = async ({ id, title, description, url, is_active }) => {
  const update = {};
  if (title?.trim()) update.title = title.trim();
  if (description !== undefined) update.description = description?.trim() || null;
  if (url?.trim()) update.url = url.trim();
  if (typeof is_active === "boolean") update.is_active = is_active;

  const r = await AffiliateResource.findByIdAndUpdate(id, update, { new: true }).lean();
  if (!r) throw new ApiError(404, "Resource not found");
  return { ...r, id: r._id };
};

export const deleteResourceService = async ({ id, password, adminId }) => {
  await verifyAdminPassword(adminId, password);
  const r = await AffiliateResource.findByIdAndDelete(id).lean();
  if (!r) throw new ApiError(404, "Resource not found");
  return { id: r._id };
};
