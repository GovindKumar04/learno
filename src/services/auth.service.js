import bcrypt from "bcrypt";
import pool from "../config/db.js";

import { ApiError } from "../utils/ApiError.js";
import { generateRollNumber } from "../utils/roll.util.js";

import {
  generateAccessToken,
  generateRefreshToken,
} from "../utils/jwt.utils.js";

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
