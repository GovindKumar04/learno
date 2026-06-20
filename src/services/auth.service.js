import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import cloudinary from "../config/cloudinary.js";
import { googleClient } from "../config/google.js";

import { User } from "../models/user.model.js";
import { Affiliate } from "../models/affiliate.model.js";

import { ApiError } from "../utils/ApiError.js";
import { generateRollNumber } from "../utils/roll.util.js";
import { escapeRegex } from "../utils/deleteGuard.util.js";

import {
  generateAccessToken,
  generateRefreshToken,
} from "../utils/jwt.utils.js";

// Sensitive columns never returned to clients / put in tokens.
const SENSITIVE = [
  "password", "refresh_token",
  "verification_code", "verification_code_expires",
  "reset_code", "reset_code_expires",
];

// Map a lean user doc to the snake_case + `id` shape callers expect, minus secrets.
const sanitizeUser = (u) => {
  if (!u) return u;
  const o = { ...u, id: u._id };
  for (const k of SENSITIVE) delete o[k];
  return o;
};

// Is this a Mongo duplicate-key error on the given field?
const isDupKey = (err, field) => err?.code === 11000 && !!err?.keyPattern?.[field];

const CODE_TTL_MINUTES = 15;
const ttlDate = () => new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000);

// Resolve an affiliate referral code → the referrer's user id (null if invalid).
export const resolveReferral = async (referralCode) => {
  if (!referralCode) return null;
  const aff = await Affiliate.findOne({ code: referralCode, status: "active" }).select("user_id").lean();
  return aff ? aff.user_id : null;
};

export const registerUserService = async ({
  full_name,
  email,
  password,
  role,
  phone,
  location,
  referredBy = null,
}) => {
  const existingUser = await User.findOne({ email }).select("_id").lean();
  if (existingUser) throw new ApiError(409, "User already exists");

  const hashedPassword = await bcrypt.hash(password, 10);

  // Assign a unique roll number (FSA-<ROLE>-<YY>-NNNN). The per-role/year sequence
  // is read then written, so a rare race could collide on the unique index —
  // retry a few times before giving up.
  for (let attempt = 0; attempt < 5; attempt++) {
    const roll_number = await generateRollNumber(role || "student");
    try {
      const user = await User.create({
        full_name,
        email,
        roll_number,
        password: hashedPassword,
        role: role || "student",
        phone,
        location,
        referred_by: referredBy,
      });
      const o = user.toObject();
      return {
        id: o._id,
        full_name: o.full_name,
        email: o.email,
        roll_number: o.roll_number,
        role: o.role,
        avatar: o.avatar ?? null,
        phone: o.phone ?? null,
        location: o.location ?? null,
        created_at: o.created_at,
      };
    } catch (err) {
      if (isDupKey(err, "roll_number")) continue;       // retry roll collision
      if (isDupKey(err, "email")) throw new ApiError(409, "User already exists");
      throw err;
    }
  }

  throw new ApiError(500, "Could not generate a unique roll number, please retry");
};

// ─── Email verification (6-digit OTP) ─────────────────────
const makeCode = () => String(Math.floor(100000 + Math.random() * 900000));

// Generates a fresh OTP, stores it hashed with an expiry, and returns the
// plain code so the caller can email it. Used by registration and resend.
export const generateAndStoreVerificationCode = async (userId) => {
  const code = makeCode();
  const hashed = await bcrypt.hash(code, 10);
  await User.findByIdAndUpdate(userId, {
    verification_code: hashed,
    verification_code_expires: ttlDate(),
  });
  return code;
};

// Verifies an emailed OTP. Throws ApiError on any failure; idempotent if the
// account is already verified.
export const verifyEmailService = async ({ email, code }) => {
  const user = await User.findOne({ email }).select("_id is_verified verification_code verification_code_expires");
  if (!user) throw new ApiError(404, "User not found");
  if (user.is_verified) return { alreadyVerified: true };

  if (!user.verification_code) {
    throw new ApiError(400, "No verification code pending. Please request a new one.");
  }
  const valid = user.verification_code_expires && user.verification_code_expires > new Date();
  if (!valid) {
    throw new ApiError(400, "Verification code has expired. Please request a new one.");
  }

  const ok = await bcrypt.compare(String(code), user.verification_code);
  if (!ok) throw new ApiError(400, "Invalid verification code");

  user.is_verified = true;
  user.verification_code = null;
  user.verification_code_expires = null;
  await user.save();
  return { alreadyVerified: false };
};

// Issues a new OTP for an unverified account. Returns { name, email, code }.
export const resendVerificationService = async ({ email }) => {
  const user = await User.findOne({ email }).select("_id full_name is_verified").lean();
  if (!user) throw new ApiError(404, "User not found");
  if (user.is_verified) throw new ApiError(409, "Email is already verified");

  const code = await generateAndStoreVerificationCode(user._id);
  return { name: user.full_name, email, code };
};

// ─── Password reset (6-digit OTP) ─────────────────────────
// Returns { name, email, code } so the controller can email it — or null if no
// such account exists (generic response avoids account enumeration).
export const requestPasswordResetService = async ({ email }) => {
  const user = await User.findOne({ email }).select("_id full_name").lean();
  if (!user) return null;

  const code = makeCode();
  const hashed = await bcrypt.hash(code, 10);
  await User.findByIdAndUpdate(user._id, {
    reset_code: hashed,
    reset_code_expires: ttlDate(),
  });
  return { name: user.full_name, email, code };
};

// Internal: validate an emailed reset code without consuming it. Returns the
// user id on success; throws a generic ApiError otherwise.
const assertValidResetCode = async ({ email, code }) => {
  const fail = () => new ApiError(400, "Invalid or expired reset code");
  const user = await User.findOne({ email }).select("_id reset_code reset_code_expires").lean();
  if (!user || !user.reset_code) throw fail();

  const valid = user.reset_code_expires && user.reset_code_expires > new Date();
  if (!valid) throw fail();

  const ok = await bcrypt.compare(String(code), user.reset_code);
  if (!ok) throw fail();
  return user._id;
};

// Soft check used by the "enter code" step — does NOT consume the code.
export const verifyResetCodeService = async ({ email, code }) => {
  await assertValidResetCode({ email, code });
  return { valid: true };
};

// Final step: re-validate the code, set the new password, consume the code, and
// invalidate the refresh token so any existing sessions are logged out.
export const resetPasswordService = async ({ email, code, newPassword }) => {
  if (!newPassword || newPassword.length < 6) {
    throw new ApiError(400, "New password must be at least 6 characters");
  }
  const userId = await assertValidResetCode({ email, code });

  const hashed = await bcrypt.hash(newPassword, 10);
  await User.findByIdAndUpdate(userId, {
    password: hashed,
    reset_code: null,
    reset_code_expires: null,
    refresh_token: null,
  });
};

// ─── Google sign-in ───────────────────────────────────────
export const googleAuthService = async ({ idToken, role }) => {
  if (!idToken) throw new ApiError(400, "Google credential is required");
  const signupRole = role === "instructor" ? "instructor" : "student";
  if (!process.env.GOOGLE_CLIENT_ID) throw new ApiError(500, "Google sign-in is not configured");

  let payload;
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    payload = ticket.getPayload();
  } catch {
    throw new ApiError(401, "Invalid Google credential");
  }

  if (!payload?.email || !payload.email_verified) {
    throw new ApiError(401, "Google account email is not verified");
  }

  const email = payload.email.toLowerCase();
  const googleId = payload.sub;
  const fullName = payload.name || email.split("@")[0];
  const avatar = payload.picture || null;

  let user = await User.findOne({ email });

  if (user) {
    // Existing account — log in, linking the Google id on first Google use.
    if (!user.google_id) {
      user.google_id = googleId;
      user.is_verified = true;
      user.avatar = user.avatar || avatar;
      await user.save();
    }
  } else {
    // New account — random unusable password (they can set a real one later via
    // forgot-password). Roll number via the same retry-on-collision loop.
    const hashedPassword = await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10);

    for (let attempt = 0; attempt < 5; attempt++) {
      const roll_number = await generateRollNumber(signupRole);
      try {
        user = await User.create({
          full_name: fullName,
          email,
          roll_number,
          password: hashedPassword,
          role: signupRole,
          google_id: googleId,
          avatar,
          is_verified: true,
        });
        break;
      } catch (err) {
        if (isDupKey(err, "roll_number")) { user = null; continue; }
        throw err;
      }
    }
    if (!user) throw new ApiError(500, "Could not generate a unique roll number, please retry");
  }

  const accessToken = generateAccessToken({ id: user._id, email: user.email, role: user.role });
  const refreshToken = generateRefreshToken({ id: user._id });
  user.refresh_token = refreshToken;
  await user.save();

  const safeUser = sanitizeUser(user.toObject());
  const profileComplete = !!(safeUser.phone && safeUser.location);
  return { user: safeUser, accessToken, refreshToken, profileComplete };
};

// Fills in phone/location after a Google sign-up (the "complete profile" step).
export const completeProfileService = async ({ userId, phone, location }) => {
  if (!/^[6-9]\d{9}$/.test(String(phone || ""))) {
    throw new ApiError(400, "Enter a valid 10-digit Indian mobile number");
  }
  if (!location || location.trim().length < 2) {
    throw new ApiError(400, "Enter your city / location");
  }

  const user = await User.findByIdAndUpdate(
    userId,
    { phone, location: location.trim() },
    { new: true }
  ).select("full_name email roll_number role phone location avatar is_verified created_at").lean();
  if (!user) throw new ApiError(404, "User not found");
  return { ...user, id: user._id };
};

export const loginUserService = async ({ email, password }) => {
  const user = await User.findOne({ email });
  if (!user) throw new ApiError(404, "User not found");

  const isPasswordCorrect = await bcrypt.compare(password, user.password || "");
  if (!isPasswordCorrect) throw new ApiError(401, "Invalid credentials");

  const accessToken = generateAccessToken({ id: user._id, email: user.email, role: user.role });
  const refreshToken = generateRefreshToken({ id: user._id });

  user.refresh_token = refreshToken;
  await user.save();

  return { user: sanitizeUser(user.toObject()), accessToken, refreshToken };
};

// Current logged-in user's public profile
export const getCurrentUserService = async (userId) => {
  const user = await User.findById(userId)
    .select("full_name email roll_number role phone location avatar is_verified is_active created_at")
    .lean();
  if (!user) throw new ApiError(404, "User not found");
  return { ...user, id: user._id };
};

// Paginated user listing with optional role filter + search (admin)
export const getUsersService = async ({ role, page = 1, limit = 50, search }) => {
  const filter = {};
  if (role) filter.role = role;
  if (search) {
    const rx = new RegExp(escapeRegex(search), "i");
    filter.$or = [{ full_name: rx }, { email: rx }, { roll_number: rx }];
  }

  const pageNum = Number(page);
  const limitNum = Number(limit);

  const [total, rows] = await Promise.all([
    User.countDocuments(filter),
    User.find(filter)
      .select("full_name email roll_number role phone location avatar is_active created_at")
      .sort({ created_at: -1 })
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum)
      .lean(),
  ]);

  return { users: rows.map((u) => ({ ...u, id: u._id })), total, page: pageNum, limit: limitNum };
};

// Upload an avatar image (path from multer) to Cloudinary and save the URL.
export const updateAvatarService = async ({ userId, filePath }) => {
  const result = await cloudinary.uploader.upload(filePath, {
    folder: "avatars",
    public_id: `user_${userId}`,
    overwrite: true,
    resource_type: "image",
    transformation: [{ width: 400, height: 400, crop: "fill", gravity: "face" }],
  });

  const user = await User.findByIdAndUpdate(
    userId,
    { avatar: result.secure_url },
    { new: true }
  ).select("full_name email roll_number role phone location avatar created_at").lean();
  if (!user) throw new ApiError(404, "User not found");
  return { ...user, id: user._id };
};

// Change password after verifying the current one
export const changePasswordService = async ({ userId, currentPassword, newPassword }) => {
  if (newPassword.length < 6) {
    throw new ApiError(400, "New password must be at least 6 characters");
  }
  const user = await User.findById(userId).select("password");
  if (!user) throw new ApiError(404, "User not found");

  const ok = await bcrypt.compare(currentPassword, user.password || "");
  if (!ok) throw new ApiError(401, "Current password is incorrect");

  user.password = await bcrypt.hash(newPassword, 10);
  await user.save();
};

// Verify a refresh token + rotate a new access token
export const refreshAccessTokenService = async (token) => {
  if (!token) throw new ApiError(401, "No refresh token");

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.REFRESH_TOKEN_SECRET);
  } catch {
    throw new ApiError(401, "Invalid or expired refresh token");
  }

  const user = await User.findById(decoded.id).select("email role refresh_token").lean();
  if (!user) throw new ApiError(404, "User not found");
  if (user.refresh_token !== token) throw new ApiError(401, "Refresh token mismatch");

  return generateAccessToken({ id: user._id, email: user.email, role: user.role });
};
