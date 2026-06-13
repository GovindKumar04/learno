import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import pool from "../config/db.js";
import cloudinary from "../config/cloudinary.js";
import { googleClient } from "../config/google.js";

import { ApiError } from "../utils/ApiError.js";
import { generateRollNumber } from "../utils/roll.util.js";

import {
  generateAccessToken,
  generateRefreshToken,
} from "../utils/jwt.utils.js";

// Resolve an affiliate referral code → the referrer's user id (null if invalid).
export const resolveReferral = async (referralCode) => {
  if (!referralCode) return null;
  const aff = await pool.query(
    "SELECT user_id FROM affiliates WHERE code = $1 AND status = 'active'",
    [referralCode]
  );
  return aff.rows.length > 0 ? aff.rows[0].user_id : null;
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
  const existingUser = await pool.query(
    `
    SELECT * FROM users
    WHERE email = $1
    `,
    [email],
  );

  if (existingUser.rows.length > 0) {
    throw new ApiError(409, "User already exists");
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  // Assign a unique roll number (FSA-<ROLE>-<YY>-NNNN). The per-role/year
  // sequence is read then written, so a rare race could collide on the UNIQUE
  // constraint — retry a few times before giving up.
  for (let attempt = 0; attempt < 5; attempt++) {
    const rollNumber = await generateRollNumber(pool, role || "student");
    try {
      const result = await pool.query(
        `
        INSERT INTO users
        (
          full_name,
          email,
          roll_number,
          password,
          role,
          phone,
          location,
          referred_by
        )
        VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8)

        RETURNING
        id,
        full_name,
        email,
        roll_number,
        role,
        avatar,
        phone,
        location,
        created_at
        `,
        [full_name, email, rollNumber, hashedPassword, role || "student", phone, location, referredBy],
      );

      return result.rows[0];
    } catch (err) {
      // Retry only on a roll_number collision; bubble up anything else.
      if (err.code === "23505" && err.constraint === "users_roll_number_key") {
        continue;
      }
      throw err;
    }
  }

  throw new ApiError(500, "Could not generate a unique roll number, please retry");
};

// ─── Email verification (6-digit OTP) ─────────────────────
const CODE_TTL_MINUTES = 15;

const makeCode = () => String(Math.floor(100000 + Math.random() * 900000));

// Generates a fresh OTP, stores it hashed with an expiry, and returns the
// plain code so the caller can email it. Used by registration and resend.
export const generateAndStoreVerificationCode = async (userId) => {
  const code = makeCode();
  const hashed = await bcrypt.hash(code, 10);
  await pool.query(
    `UPDATE users
       SET verification_code = $1,
           verification_code_expires = NOW() + INTERVAL '${CODE_TTL_MINUTES} minutes',
           updated_at = NOW()
     WHERE id = $2`,
    [hashed, userId]
  );
  return code;
};

// Verifies an emailed OTP. Throws ApiError on any failure; idempotent if the
// account is already verified.
export const verifyEmailService = async ({ email, code }) => {
  // Compare the expiry inside Postgres (code_valid) so the check uses a single
  // consistent timezone basis. Doing it in JS is unreliable because node-pg
  // parses a `TIMESTAMP` (no tz) column into a Date in the Node server's local
  // timezone, which skews the comparison and can mark a fresh code "expired".
  const { rows } = await pool.query(
    `SELECT id, is_verified, verification_code,
            (verification_code_expires IS NOT NULL AND verification_code_expires > NOW()) AS code_valid
       FROM users WHERE email = $1`,
    [email]
  );
  if (rows.length === 0) throw new ApiError(404, "User not found");

  const user = rows[0];
  if (user.is_verified) return { alreadyVerified: true };

  if (!user.verification_code) {
    throw new ApiError(400, "No verification code pending. Please request a new one.");
  }
  if (!user.code_valid) {
    throw new ApiError(400, "Verification code has expired. Please request a new one.");
  }

  const ok = await bcrypt.compare(String(code), user.verification_code);
  if (!ok) throw new ApiError(400, "Invalid verification code");

  await pool.query(
    `UPDATE users
       SET is_verified = true,
           verification_code = NULL,
           verification_code_expires = NULL,
           updated_at = NOW()
     WHERE id = $1`,
    [user.id]
  );
  return { alreadyVerified: false };
};

// Issues a new OTP for an unverified account. Returns { name, email, code }
// for the controller to email.
export const resendVerificationService = async ({ email }) => {
  const { rows } = await pool.query(
    `SELECT id, full_name, is_verified FROM users WHERE email = $1`,
    [email]
  );
  if (rows.length === 0) throw new ApiError(404, "User not found");

  const user = rows[0];
  if (user.is_verified) throw new ApiError(409, "Email is already verified");

  const code = await generateAndStoreVerificationCode(user.id);
  return { name: user.full_name, email, code };
};

// ─── Password reset (6-digit OTP) ─────────────────────────
// Issues a reset code for an account. Returns { name, email, code } so the
// controller can email it — or null if no such account exists. Returning null
// (instead of throwing 404) lets the controller respond generically and avoid
// leaking which emails are registered (account-enumeration protection).
export const requestPasswordResetService = async ({ email }) => {
  const { rows } = await pool.query(
    `SELECT id, full_name FROM users WHERE email = $1`,
    [email]
  );
  if (rows.length === 0) return null;

  const code = makeCode();
  const hashed = await bcrypt.hash(code, 10);
  await pool.query(
    `UPDATE users
       SET reset_code = $1,
           reset_code_expires = NOW() + INTERVAL '${CODE_TTL_MINUTES} minutes',
           updated_at = NOW()
     WHERE id = $2`,
    [hashed, rows[0].id]
  );
  return { name: rows[0].full_name, email, code };
};

// Internal: validate an emailed reset code without consuming it. Returns the
// user id on success; throws ApiError otherwise. Expiry is evaluated in
// Postgres (code_valid) to dodge the TIMESTAMP/timezone skew noted above.
const assertValidResetCode = async ({ email, code }) => {
  const { rows } = await pool.query(
    `SELECT id, reset_code,
            (reset_code_expires IS NOT NULL AND reset_code_expires > NOW()) AS code_valid
       FROM users WHERE email = $1`,
    [email]
  );
  // Generic error — don't reveal whether the email exists.
  const fail = () => new ApiError(400, "Invalid or expired reset code");
  if (rows.length === 0) throw fail();

  const user = rows[0];
  if (!user.reset_code || !user.code_valid) throw fail();

  const ok = await bcrypt.compare(String(code), user.reset_code);
  if (!ok) throw fail();
  return user.id;
};

// Soft check used by the "enter code" step — confirms the code is good before
// the UI shows the new-password field. Does NOT consume the code.
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
  await pool.query(
    `UPDATE users
       SET password = $1,
           reset_code = NULL,
           reset_code_expires = NULL,
           refresh_token = NULL,
           updated_at = NOW()
     WHERE id = $2`,
    [hashed, userId]
  );
};

// ─── Google sign-in ───────────────────────────────────────
// Verifies a Google ID token, finds-or-creates the user, and issues our own
// access/refresh tokens (same as password login). Returns profileComplete so
// the client knows whether to ask a new user for phone/location.
export const googleAuthService = async ({ idToken }) => {
  if (!idToken) throw new ApiError(400, "Google credential is required");
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

  const existing = await pool.query(`SELECT * FROM users WHERE email = $1`, [email]);
  let user;

  if (existing.rows.length > 0) {
    // Existing account — log in, linking the Google id on first Google use.
    user = existing.rows[0];
    if (!user.google_id) {
      await pool.query(
        `UPDATE users
           SET google_id = $1, is_verified = true,
               avatar = COALESCE(avatar, $2), updated_at = NOW()
         WHERE id = $3`,
        [googleId, avatar, user.id]
      );
      user.google_id = googleId;
      user.is_verified = true;
      user.avatar = user.avatar || avatar;
    }
  } else {
    // New account — random unusable password (they can set a real one later via
    // forgot-password). Roll number via the same retry-on-collision loop as
    // registerUserService. phone/location stay NULL until the profile step.
    const hashedPassword = await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10);

    for (let attempt = 0; attempt < 5; attempt++) {
      const rollNumber = await generateRollNumber(pool, "student");
      try {
        const inserted = await pool.query(
          `INSERT INTO users (full_name, email, roll_number, password, role, google_id, avatar, is_verified)
           VALUES ($1, $2, $3, $4, 'student', $5, $6, true)
           RETURNING *`,
          [fullName, email, rollNumber, hashedPassword, googleId, avatar]
        );
        user = inserted.rows[0];
        break;
      } catch (err) {
        if (err.code === "23505" && err.constraint === "users_roll_number_key") continue;
        throw err;
      }
    }
    if (!user) throw new ApiError(500, "Could not generate a unique roll number, please retry");
  }

  const accessToken = generateAccessToken(user);
  const refreshToken = generateRefreshToken(user);
  await pool.query(`UPDATE users SET refresh_token = $1 WHERE id = $2`, [refreshToken, user.id]);

  // Strip everything sensitive before returning.
  for (const k of ["password", "refresh_token", "verification_code", "verification_code_expires", "reset_code", "reset_code_expires"]) {
    delete user[k];
  }

  const profileComplete = !!(user.phone && user.location);
  return { user, accessToken, refreshToken, profileComplete };
};

// Fills in phone/location after a Google sign-up (the "complete profile" step).
export const completeProfileService = async ({ userId, phone, location }) => {
  if (!/^[6-9]\d{9}$/.test(String(phone || ""))) {
    throw new ApiError(400, "Enter a valid 10-digit Indian mobile number");
  }
  if (!location || location.trim().length < 2) {
    throw new ApiError(400, "Enter your city / location");
  }

  const result = await pool.query(
    `UPDATE users SET phone = $1, location = $2, updated_at = NOW()
       WHERE id = $3
       RETURNING id, full_name, email, roll_number, role, phone, location, avatar, is_verified, created_at`,
    [phone, location.trim(), userId]
  );
  if (result.rows.length === 0) throw new ApiError(404, "User not found");
  return result.rows[0];
};

export const loginUserService = async ({ email, password }) => {
  const userResult = await pool.query(
    `
    SELECT * FROM users
    WHERE email = $1
    `,
    [email],
  );

  if (userResult.rows.length === 0) {
    throw new ApiError(404, "User not found");
  }

  const user = userResult.rows[0];

  const isPasswordCorrect = await bcrypt.compare(password, user.password);

  if (!isPasswordCorrect) {
    throw new ApiError(401, "Invalid credentials");
  }

  const accessToken = generateAccessToken(user);

  const refreshToken = generateRefreshToken(user);

  await pool.query(
    `
    UPDATE users
    SET refresh_token = $1
    WHERE id = $2
    `,
    [refreshToken, user.id],
  );

  delete user.password;
  delete user.refresh_token;

  return {
    user,
    accessToken,
    refreshToken,
  };
};

// Current logged-in user's public profile
export const getCurrentUserService = async (userId) => {
  const result = await pool.query(
    `SELECT id, full_name, email, roll_number, role, phone, location, avatar, is_verified, is_active, created_at
     FROM users WHERE id = $1`,
    [userId]
  );
  if (result.rows.length === 0) throw new ApiError(404, "User not found");
  return result.rows[0];
};

// Paginated user listing with optional role filter + search (admin)
export const getUsersService = async ({ role, page = 1, limit = 50, search }) => {
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

  return { users: result.rows, total, page: Number(page), limit: Number(limit) };
};

// Upload an avatar image (path from multer) to Cloudinary and save the URL.
export const updateAvatarService = async ({ userId, filePath }) => {
  // Deterministic public_id per user → re-uploads overwrite the old image.
  const result = await cloudinary.uploader.upload(filePath, {
    folder: "avatars",
    public_id: `user_${userId}`,
    overwrite: true,
    resource_type: "image",
    transformation: [{ width: 400, height: 400, crop: "fill", gravity: "face" }],
  });

  const updated = await pool.query(
    `UPDATE users SET avatar = $1, updated_at = NOW()
     WHERE id = $2
     RETURNING id, full_name, email, roll_number, role, phone, location, avatar, created_at`,
    [result.secure_url, userId]
  );
  if (updated.rows.length === 0) throw new ApiError(404, "User not found");
  return updated.rows[0];
};

// Change password after verifying the current one
export const changePasswordService = async ({ userId, currentPassword, newPassword }) => {
  if (newPassword.length < 6) {
    throw new ApiError(400, "New password must be at least 6 characters");
  }
  const result = await pool.query("SELECT password FROM users WHERE id = $1", [userId]);
  if (result.rows.length === 0) throw new ApiError(404, "User not found");

  const ok = await bcrypt.compare(currentPassword, result.rows[0].password);
  if (!ok) throw new ApiError(401, "Current password is incorrect");

  const hashed = await bcrypt.hash(newPassword, 10);
  await pool.query("UPDATE users SET password = $1, updated_at = NOW() WHERE id = $2", [hashed, userId]);
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

  const result = await pool.query(
    `SELECT id, email, role, refresh_token FROM users WHERE id = $1`,
    [decoded.id]
  );
  if (result.rows.length === 0) throw new ApiError(404, "User not found");

  const user = result.rows[0];
  if (user.refresh_token !== token) throw new ApiError(401, "Refresh token mismatch");

  return generateAccessToken(user);
};
