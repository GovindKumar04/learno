import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import fs from "fs";
import { asyncHandler } from "../utils/asyncHandler.js";
import {
  registerUserService,
  loginUserService,
  generateAndStoreVerificationCode,
  verifyEmailService,
  resendVerificationService,
} from "../services/auth.service.js";
import { sendVerificationMail } from "../utils/mail.util.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { cookieOptions } from "../middlewares/cookie.options.js";
import { generateAccessToken } from "../utils/jwt.utils.js";
import cloudinary from "../config/cloudinary.js";
import pool from "../config/db.js";

export const registerUser = asyncHandler(async (req, res) => {
  const { full_name, email, password, role, phone, location, referralCode } = req.body;

  if (role === "admin") throw new ApiError(401, "Admin user can't be registered");

  if (!full_name || !email || !password || !role || !phone || !location) {
    throw new ApiError(400, "All fields are required");
  }

  // Resolve affiliate referral code → referrer's user id (ignored if invalid)
  let referredBy = null;
  if (referralCode) {
    const aff = await pool.query(
      "SELECT user_id FROM affiliates WHERE code = $1 AND status = 'active'",
      [referralCode]
    );
    if (aff.rows.length > 0) referredBy = aff.rows[0].user_id;
  }

  const user = await registerUserService({
    full_name, email, password, role, phone, location, referredBy,
  });

  // Email a verification code. Non-blocking: if mail fails the account still
  // exists (login is allowed) and the user can request a fresh code.
  try {
    const code = await generateAndStoreVerificationCode(user.id);
    await sendVerificationMail({ name: user.full_name, email: user.email, code });
  } catch (err) {
    console.error(`Verification email failed for ${email}:`, err.message);
  }

  return res
    .status(201)
    .json(new ApiResponse(201, { ...user, is_verified: false }, "User registered successfully"));
});

// POST /auth/verify-email  (public) — confirm an emailed OTP
export const verifyEmail = asyncHandler(async (req, res) => {
  const { email, code } = req.body;
  if (!email || !code) throw new ApiError(400, "Email and code are required");

  const { alreadyVerified } = await verifyEmailService({ email, code });
  return res.status(200).json(
    new ApiResponse(200, { verified: true }, alreadyVerified ? "Email already verified" : "Email verified successfully")
  );
});

// POST /auth/resend-verification  (public) — issue a fresh OTP
export const resendVerification = asyncHandler(async (req, res) => {
  const { email } = req.body;
  if (!email) throw new ApiError(400, "Email is required");

  const { name, code } = await resendVerificationService({ email });
  await sendVerificationMail({ name, email, code });

  return res.status(200).json(new ApiResponse(200, {}, "Verification code sent"));
});

export const loginUser = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const { user, accessToken, refreshToken } = await loginUserService({ email, password });

  return res
    .status(200)
    .cookie("accessToken", accessToken, cookieOptions)
    .cookie("refreshToken", refreshToken, cookieOptions)
    .json(new ApiResponse(200, { user, accessToken }, "Login successful"));
});

export const logoutUser = asyncHandler(async (req, res) => {
  return res
    .status(200)
    .clearCookie("accessToken", cookieOptions)
    .clearCookie("refreshToken", cookieOptions)
    .json(new ApiResponse(200, {}, "Logout successful"));
});

export const getCurrentUser = asyncHandler(async (req, res) => {
  const userId = req.user.id;

  const result = await pool.query(
    `SELECT id, full_name, email, roll_number, role, phone, avatar, is_verified, is_active, created_at
     FROM users WHERE id = $1`,
    [userId]
  );

  if (result.rows.length === 0) throw new ApiError(404, "User not found");

  return res.status(200).json(new ApiResponse(200, result.rows[0], "Current user fetched successfully"));
});


// GET /auth/users?role=instructor&page=1&limit=20  (admin only)
export const getUsers = asyncHandler(async (req, res) => {
  const { role, page = 1, limit = 50, search } = req.query;

  const conditions = [];
  const params = [];

  if (role) {
    params.push(role);
    conditions.push(`role = $${params.length}`);
  }
  if (search) {
    params.push(`%${search}%`);
    conditions.push(`(full_name ILIKE $${params.length} OR email ILIKE $${params.length} OR roll_number ILIKE $${params.length})`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const countResult = await pool.query(`SELECT COUNT(*) FROM users ${where}`, params);
  const total = Number(countResult.rows[0].count);

  params.push(Number(limit), (Number(page) - 1) * Number(limit));
  const result = await pool.query(
    `SELECT id, full_name, email, roll_number, role, phone, location, avatar, is_active, created_at
     FROM users ${where}
     ORDER BY created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  return res.status(200).json(new ApiResponse(200, {
    users: result.rows,
    total,
    page: Number(page),
    limit: Number(limit),
  }));
});

// PATCH /auth/avatar  (any logged-in user)
// multipart/form-data, field name "avatar" — uploads to Cloudinary and saves the URL.
export const updateAvatar = asyncHandler(async (req, res) => {
  if (!req.file) throw new ApiError(400, "No avatar image provided (field name: 'avatar')");

  try {
    // Deterministic public_id per user → re-uploads overwrite the old image (no orphans).
    // secure_url carries a new version each time, so it busts the browser cache.
    const result = await cloudinary.uploader.upload(req.file.path, {
      folder: "avatars",
      public_id: `user_${req.user.id}`,
      overwrite: true,
      resource_type: "image",
      transformation: [{ width: 400, height: 400, crop: "fill", gravity: "face" }],
    });

    const updated = await pool.query(
      `UPDATE users SET avatar = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING id, full_name, email, roll_number, role, phone, location, avatar, created_at`,
      [result.secure_url, req.user.id]
    );

    if (updated.rows.length === 0) throw new ApiError(404, "User not found");

    return res.status(200).json(new ApiResponse(200, updated.rows[0], "Avatar updated successfully"));
  } finally {
    // multer wrote a temp file — always clean it up
    if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
  }
});

// POST /auth/change-password  (any logged-in user)
export const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    throw new ApiError(400, "Current and new password are required");
  }
  if (newPassword.length < 6) {
    throw new ApiError(400, "New password must be at least 6 characters");
  }

  const userId = req.user.id;
  const result = await pool.query("SELECT password FROM users WHERE id = $1", [userId]);
  if (result.rows.length === 0) throw new ApiError(404, "User not found");

  const ok = await bcrypt.compare(currentPassword, result.rows[0].password);
  if (!ok) throw new ApiError(401, "Current password is incorrect");

  const hashed = await bcrypt.hash(newPassword, 10);
  await pool.query("UPDATE users SET password = $1, updated_at = NOW() WHERE id = $2", [hashed, userId]);

  return res.status(200).json(new ApiResponse(200, {}, "Password updated successfully"));
});

export const refreshAccessToken = asyncHandler(async (req, res) => {
  const token = req.cookies?.refreshToken;
  if (!token) throw new ApiError(401, "No refresh token");

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.REFRESH_TOKEN_SECRET);
  } catch {
    throw new ApiError(401, "Invalid or expired refresh token");
  }

  const result = await pool.query(
    `SELECT id, email, role, refresh_token FROM users WHERE id = $1`,
    [decoded.id]
  );

  if (result.rows.length === 0) throw new ApiError(404, "User not found");

  const user = result.rows[0];
  if (user.refresh_token !== token) throw new ApiError(401, "Refresh token mismatch");

  const newAccessToken = generateAccessToken(user);

  return res
    .status(200)
    .cookie("accessToken", newAccessToken, cookieOptions)
    .json(new ApiResponse(200, { accessToken: newAccessToken }, "Token refreshed"));
});