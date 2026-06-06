// Migration: add email-verification columns to users.
//
// Run:  cd backend && npm run migrate:verify
//
// Idempotent — uses ADD COLUMN IF NOT EXISTS, safe to re-run.
//   verification_code         hashed 6-digit OTP (bcrypt), NULL once verified
//   verification_code_expires when the current code stops being valid

import "dotenv/config";

import pool from "../config/db.js";

async function migrate() {
  try {
    await pool.query(
      `ALTER TABLE users
         ADD COLUMN IF NOT EXISTS verification_code TEXT,
         ADD COLUMN IF NOT EXISTS verification_code_expires TIMESTAMP`
    );
    console.log("✓ verification_code / verification_code_expires columns ensured");
    process.exit(0);
  } catch (error) {
    console.error("Email-verification migration failed:");
    console.error(error);
    process.exit(1);
  }
}

migrate();
