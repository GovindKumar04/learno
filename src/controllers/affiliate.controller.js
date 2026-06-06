import crypto from "crypto";
import bcrypt from "bcrypt";
import pool from "../config/db.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { sendAffiliateApprovalMail, sendAffiliateRejectionMail } from "../utils/mail.util.js";

const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:5173";

// Generate a short, readable, unique referral code
const generateCode = () =>
  `FSA-${crypto.randomBytes(3).toString("hex").toUpperCase()}`; // e.g. FSA-9C3A1F

// Generate a readable temporary password for a new affiliate account
const generatePassword = () =>
  crypto.randomBytes(9).toString("base64").replace(/[^a-zA-Z0-9]/g, "").slice(0, 10) + "9!";

// ─────────────────────────────────────────────────────────────────────────────
// POST /affiliates/apply  (public — no auth)
// A third party applies to join the affiliate program. No account is created
// here; admin reviews the application and, on approval, an affiliate-role user
// with login credentials is generated (Phase 3).
// ─────────────────────────────────────────────────────────────────────────────
const applyAffiliate = asyncHandler(async (req, res) => {
  const { full_name, email, phone, bio } = req.body;

  if (!full_name?.trim() || !email?.trim()) {
    throw new ApiError(400, "Full name and email are required");
  }
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRe.test(email.trim())) throw new ApiError(400, "Please provide a valid email");

  // Normalise social_links → array of { platform, url } (drop empty rows)
  const raw = Array.isArray(req.body.social_links) ? req.body.social_links : [];
  const social_links = raw
    .map((s) => ({
      platform: String(s?.platform || "").trim(),
      url: String(s?.url || "").trim(),
    }))
    .filter((s) => s.url);

  // Block re-applying if an active affiliate already exists for this email
  const existingAff = await pool.query(
    `SELECT a.id FROM affiliates a
     JOIN users u ON u.id = a.user_id
     WHERE lower(u.email) = lower($1)`,
    [email.trim()]
  );
  if (existingAff.rows.length > 0) {
    throw new ApiError(409, "An affiliate account already exists for this email");
  }

  try {
    const result = await pool.query(
      `INSERT INTO affiliate_applications (full_name, email, phone, bio, social_links)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       RETURNING id, full_name, email, status, created_at`,
      [full_name.trim(), email.trim(), phone?.trim() || null, bio?.trim() || null, JSON.stringify(social_links)]
    );
    return res.status(201).json(
      new ApiResponse(201, result.rows[0], "Application submitted — we'll review it and email you shortly")
    );
  } catch (e) {
    // Partial unique index on (lower(email)) WHERE status='pending'
    if (e.code === "23505") {
      throw new ApiError(409, "You already have a pending application with this email");
    }
    throw e;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /affiliates/me  (user)
// Affiliate's own profile, stats, and commission history
// ─────────────────────────────────────────────────────────────────────────────
const getMyAffiliate = asyncHandler(async (req, res) => {
  const userId = req.user.id;

  const affRes = await pool.query("SELECT * FROM affiliates WHERE user_id = $1", [userId]);
  if (affRes.rows.length === 0) {
    return res.json(new ApiResponse(200, { isAffiliate: false }));
  }
  const affiliate = affRes.rows[0];

  // Referred users count
  const refCount = await pool.query(
    "SELECT COUNT(*) FROM users WHERE referred_by = $1",
    [userId]
  );

  // Commission totals by status
  const totals = await pool.query(
    `SELECT
       COALESCE(SUM(commission_amount), 0)                                       AS total,
       COALESCE(SUM(commission_amount) FILTER (WHERE status = 'pending'), 0)     AS pending,
       COALESCE(SUM(commission_amount) FILTER (WHERE status = 'approved'), 0)    AS approved,
       COALESCE(SUM(commission_amount) FILTER (WHERE status = 'paid'), 0)        AS paid,
       COUNT(*)                                                                  AS sales
     FROM commissions WHERE affiliate_user_id = $1`,
    [userId]
  );

  // Recent commissions
  const commissions = await pool.query(
    `SELECT id, course_title, sale_amount, commission_amount, status, created_at, paid_at
     FROM commissions WHERE affiliate_user_id = $1 ORDER BY created_at DESC LIMIT 50`,
    [userId]
  );

  const t = totals.rows[0];

  return res.json(new ApiResponse(200, {
    isAffiliate: true,
    code: affiliate.code,
    referralLink: `${CLIENT_URL}/?ref=${affiliate.code}`,
    commissionType: affiliate.commission_type,
    commissionValue: Number(affiliate.commission_value),
    status: affiliate.status,
    clicks: affiliate.clicks,
    stats: {
      referredUsers: Number(refCount.rows[0].count),
      totalSales: Number(t.sales),
      // amounts are stored in paise → convert to rupees for display
      totalEarned: Number(t.total) / 100,
      pending: Number(t.pending) / 100,
      approved: Number(t.approved) / 100,
      paid: Number(t.paid) / 100,
    },
    commissions: commissions.rows.map((c) => ({
      ...c,
      sale_amount: c.sale_amount / 100,
      commission_amount: c.commission_amount / 100,
    })),
  }));
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /affiliates/track/:code  (public)
// Increment click counter when a referral link is visited
// ─────────────────────────────────────────────────────────────────────────────
const trackClick = asyncHandler(async (req, res) => {
  await pool.query(
    "UPDATE affiliates SET clicks = clicks + 1 WHERE code = $1 AND status = 'active'",
    [req.params.code]
  );
  return res.json(new ApiResponse(200, { tracked: true }));
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /affiliates/applications  (admin)
// List affiliate applications (optional ?status=pending|approved|rejected)
// ─────────────────────────────────────────────────────────────────────────────
const getApplications = asyncHandler(async (req, res) => {
  const { status } = req.query;
  const where = status ? "WHERE status = $1" : "";
  const params = status ? [status] : [];

  const result = await pool.query(
    `SELECT id, full_name, email, phone, bio, social_links, status, review_note, user_id, reviewed_at, created_at
     FROM affiliate_applications
     ${where}
     ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END, created_at DESC`,
    params
  );

  const countsRes = await pool.query(
    `SELECT status, COUNT(*) FROM affiliate_applications GROUP BY status`
  );
  const counts = { pending: 0, approved: 0, rejected: 0 };
  countsRes.rows.forEach((r) => { counts[r.status] = Number(r.count); });

  return res.json(new ApiResponse(200, { applications: result.rows, counts }));
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /affiliates/applications/:id  (admin)
// Approve (→ create affiliate-role user + affiliate record + email creds) or reject
// ─────────────────────────────────────────────────────────────────────────────
const reviewApplication = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { action, review_note } = req.body;

  if (!["approve", "reject"].includes(action)) {
    throw new ApiError(400, "action must be 'approve' or 'reject'");
  }

  const appRes = await pool.query("SELECT * FROM affiliate_applications WHERE id = $1", [id]);
  if (appRes.rows.length === 0) throw new ApiError(404, "Application not found");
  const application = appRes.rows[0];
  if (application.status !== "pending") {
    throw new ApiError(409, `Application already ${application.status}`);
  }

  // ── Reject ──────────────────────────────────────────────────────────────────
  if (action === "reject") {
    const upd = await pool.query(
      `UPDATE affiliate_applications
       SET status = 'rejected', review_note = $1, reviewed_at = NOW()
       WHERE id = $2 RETURNING *`,
      [review_note?.trim() || null, id]
    );
    sendAffiliateRejectionMail({
      name: application.full_name, email: application.email, note: review_note?.trim(),
    }).catch(() => {});
    return res.json(new ApiResponse(200, upd.rows[0], "Application rejected"));
  }

  // ── Approve ───────────────────────────────────────────────────────────────--
  // Guard: email must not already belong to a user account
  const existingUser = await pool.query(
    "SELECT id FROM users WHERE lower(email) = lower($1)",
    [application.email]
  );
  if (existingUser.rows.length > 0) {
    throw new ApiError(409, "A user with this email already exists — resolve manually before approving");
  }

  const tempPassword = generatePassword();
  const hashed = await bcrypt.hash(tempPassword, 10);

  // Transaction: create user + affiliate, mark application approved
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // users.phone and users.location are NOT NULL → supply safe fallbacks
    const userIns = await client.query(
      `INSERT INTO users (full_name, email, password, role, phone, location)
       VALUES ($1, $2, $3, 'affiliate', $4, $5) RETURNING id`,
      [application.full_name, application.email, hashed, application.phone || "N/A", "Not specified"]
    );
    const userId = userIns.rows[0].id;

    // Unique referral code (retry on rare collision)
    let code = null;
    for (let i = 0; i < 5; i++) {
      const candidate = generateCode();
      const clash = await client.query("SELECT 1 FROM affiliates WHERE code = $1", [candidate]);
      if (clash.rows.length === 0) { code = candidate; break; }
    }
    if (!code) throw new ApiError(500, "Could not generate a referral code, please retry");

    await client.query(
      `INSERT INTO affiliates (user_id, code, bio, social_links)
       VALUES ($1, $2, $3, $4::jsonb)`,
      [userId, code, application.bio, JSON.stringify(application.social_links || [])]
    );

    await client.query(
      `UPDATE affiliate_applications
       SET status = 'approved', user_id = $1, reviewed_at = NOW()
       WHERE id = $2`,
      [userId, id]
    );

    await client.query("COMMIT");

    sendAffiliateApprovalMail({
      name: application.full_name, email: application.email, tempPassword, code,
    }).catch(() => {});

    return res.json(new ApiResponse(200, {
      userId, code, email: application.email,
    }, "Affiliate approved — login credentials emailed"));
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /affiliates  (admin)
// All affiliates with applicant info + earning/referral totals
// ─────────────────────────────────────────────────────────────────────────────
const getAllAffiliates = asyncHandler(async (req, res) => {
  const result = await pool.query(`
    SELECT
      a.id, a.user_id, a.code, a.commission_type, a.commission_value,
      a.status, a.clicks, a.created_at,
      u.full_name, u.email, u.phone,
      (SELECT COUNT(*) FROM users r WHERE r.referred_by = a.user_id)            AS referred_users,
      COALESCE((SELECT SUM(c.commission_amount) FROM commissions c WHERE c.affiliate_user_id = a.user_id), 0) AS total_earned,
      COALESCE((SELECT SUM(c.commission_amount) FROM commissions c WHERE c.affiliate_user_id = a.user_id AND c.status != 'paid'), 0) AS unpaid
    FROM affiliates a
    LEFT JOIN users u ON u.id = a.user_id
    ORDER BY a.created_at DESC
  `);

  const affiliates = result.rows.map((a) => ({
    ...a,
    commission_value: Number(a.commission_value),
    referred_users: Number(a.referred_users),
    total_earned: Number(a.total_earned) / 100,
    unpaid: Number(a.unpaid) / 100,
  }));

  // Platform summary
  const sum = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM affiliates)                                           AS total_affiliates,
      COALESCE((SELECT SUM(commission_amount) FROM commissions), 0)               AS total_commission,
      COALESCE((SELECT SUM(commission_amount) FROM commissions WHERE status='paid'), 0)     AS paid,
      COALESCE((SELECT SUM(commission_amount) FROM commissions WHERE status!='paid'), 0)    AS unpaid
  `);
  const sr = sum.rows[0];

  return res.json(new ApiResponse(200, {
    affiliates,
    summary: {
      totalAffiliates: Number(sr.total_affiliates),
      totalCommission: Number(sr.total_commission) / 100,
      paid: Number(sr.paid) / 100,
      unpaid: Number(sr.unpaid) / 100,
    },
  }));
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /affiliates/:userId  (admin)
// Update an affiliate's commission rate / type / status
// ─────────────────────────────────────────────────────────────────────────────
const updateAffiliate = asyncHandler(async (req, res) => {
  const { commission_type, commission_value, status } = req.body;
  const { userId } = req.params;

  if (commission_type && !["percent", "flat"].includes(commission_type)) {
    throw new ApiError(400, "commission_type must be 'percent' or 'flat'");
  }
  if (status && !["active", "suspended"].includes(status)) {
    throw new ApiError(400, "status must be 'active' or 'suspended'");
  }

  const result = await pool.query(
    `UPDATE affiliates SET
       commission_type  = COALESCE($1, commission_type),
       commission_value = COALESCE($2, commission_value),
       status           = COALESCE($3, status),
       updated_at       = NOW()
     WHERE user_id = $4
     RETURNING *`,
    [
      commission_type ?? null,
      commission_value !== undefined ? Number(commission_value) : null,
      status ?? null,
      userId,
    ]
  );

  if (result.rows.length === 0) throw new ApiError(404, "Affiliate not found");
  return res.json(new ApiResponse(200, result.rows[0], "Affiliate updated"));
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /affiliates/commissions  (admin)
// All commissions with affiliate + referred-user info, filter by status
// ─────────────────────────────────────────────────────────────────────────────
const getCommissions = asyncHandler(async (req, res) => {
  const { status, page = 1, limit = 30 } = req.query;
  const pageNum = Number(page), limitNum = Number(limit);

  const where = status ? "WHERE c.status = $1" : "";
  const params = status ? [status] : [];

  const countRes = await pool.query(`SELECT COUNT(*) FROM commissions c ${where}`, params);
  const total = Number(countRes.rows[0].count);

  params.push(limitNum, (pageNum - 1) * limitNum);
  const result = await pool.query(
    `SELECT
       c.id, c.course_title, c.sale_amount, c.commission_amount, c.status, c.created_at, c.paid_at,
       af.full_name AS affiliate_name, af.email AS affiliate_email,
       ru.full_name AS referred_name
     FROM commissions c
     LEFT JOIN users af ON af.id = c.affiliate_user_id
     LEFT JOIN users ru ON ru.id = c.referred_user_id
     ${where}
     ORDER BY c.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  const commissions = result.rows.map((c) => ({
    ...c,
    sale_amount: c.sale_amount / 100,
    commission_amount: c.commission_amount / 100,
  }));

  return res.json(new ApiResponse(200, { commissions, total, page: pageNum, limit: limitNum }));
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /affiliates/commissions/:id  (admin)
// Update a commission's status (approved / paid)
// ─────────────────────────────────────────────────────────────────────────────
const updateCommissionStatus = asyncHandler(async (req, res) => {
  const { status } = req.body;
  if (!["pending", "approved", "paid"].includes(status)) {
    throw new ApiError(400, "status must be pending, approved or paid");
  }

  const paidAt = status === "paid" ? "NOW()" : "NULL";
  const result = await pool.query(
    `UPDATE commissions SET status = $1, paid_at = ${paidAt} WHERE id = $2 RETURNING *`,
    [status, req.params.id]
  );
  if (result.rows.length === 0) throw new ApiError(404, "Commission not found");

  return res.json(new ApiResponse(200, result.rows[0], `Commission marked ${status}`));
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /affiliates/resources  (admin + affiliate)
// Affiliates see only active resources; admin sees all (incl. inactive)
// ─────────────────────────────────────────────────────────────────────────────
const getResources = asyncHandler(async (req, res) => {
  const where = req.user.role === "admin" ? "" : "WHERE is_active = true";
  const result = await pool.query(
    `SELECT id, title, description, url, is_active, created_at, updated_at
     FROM affiliate_resources ${where} ORDER BY created_at DESC`
  );
  return res.json(new ApiResponse(200, result.rows));
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /affiliates/resources  (admin)
// ─────────────────────────────────────────────────────────────────────────────
const createResource = asyncHandler(async (req, res) => {
  const { title, description, url } = req.body;
  if (!title?.trim() || !url?.trim()) {
    throw new ApiError(400, "Title and URL are required");
  }
  const result = await pool.query(
    `INSERT INTO affiliate_resources (title, description, url)
     VALUES ($1, $2, $3) RETURNING *`,
    [title.trim(), description?.trim() || null, url.trim()]
  );
  return res.status(201).json(new ApiResponse(201, result.rows[0], "Resource added"));
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /affiliates/resources/:id  (admin)
// ─────────────────────────────────────────────────────────────────────────────
const updateResource = asyncHandler(async (req, res) => {
  const { title, description, url, is_active } = req.body;
  const result = await pool.query(
    `UPDATE affiliate_resources SET
       title       = COALESCE($1, title),
       description = COALESCE($2, description),
       url         = COALESCE($3, url),
       is_active   = COALESCE($4, is_active),
       updated_at  = NOW()
     WHERE id = $5 RETURNING *`,
    [
      title?.trim() ?? null,
      description !== undefined ? (description?.trim() || null) : null,
      url?.trim() ?? null,
      typeof is_active === "boolean" ? is_active : null,
      req.params.id,
    ]
  );
  if (result.rows.length === 0) throw new ApiError(404, "Resource not found");
  return res.json(new ApiResponse(200, result.rows[0], "Resource updated"));
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /affiliates/resources/:id  (admin)
// ─────────────────────────────────────────────────────────────────────────────
const deleteResource = asyncHandler(async (req, res) => {
  const result = await pool.query(
    "DELETE FROM affiliate_resources WHERE id = $1 RETURNING id",
    [req.params.id]
  );
  if (result.rows.length === 0) throw new ApiError(404, "Resource not found");
  return res.json(new ApiResponse(200, { id: result.rows[0].id }, "Resource deleted"));
});

export {
  applyAffiliate,
  getMyAffiliate,
  trackClick,
  getApplications,
  reviewApplication,
  getAllAffiliates,
  updateAffiliate,
  getCommissions,
  updateCommissionStatus,
  getResources,
  createResource,
  updateResource,
  deleteResource,
};
