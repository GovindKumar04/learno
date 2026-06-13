// Migration: support Google sign-in on the users table.
//
// Run:  cd backend && npm run migrate:google
//
// Idempotent.
//   google_id   Google's stable account id ("sub"); links a user to Google.
//   password / phone / location → made nullable, because a Google account
//   doesn't provide them. (Google users get a random unusable password hash, and
//   are asked to complete phone/location right after their first sign-in.)

import "dotenv/config";
import pool from "../config/db.js";

async function migrate() {
  try {
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id TEXT`);
    // UNIQUE on google_id, but only one such constraint. Postgres allows many
    // NULLs under a UNIQUE index, so existing non-Google rows are unaffected.
    await pool.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_indexes WHERE indexname = 'users_google_id_key'
        ) THEN
          CREATE UNIQUE INDEX users_google_id_key ON users (google_id);
        END IF;
      END $$;
    `);
    console.log("✓ google_id column + unique index ready");

    await pool.query(`ALTER TABLE users ALTER COLUMN password DROP NOT NULL`);
    await pool.query(`ALTER TABLE users ALTER COLUMN phone DROP NOT NULL`);
    await pool.query(`ALTER TABLE users ALTER COLUMN location DROP NOT NULL`);
    console.log("✓ password / phone / location are now nullable");

    console.log("✅ Google-auth migration complete");
    process.exit(0);
  } catch (error) {
    console.error("Google-auth migration failed:");
    console.error(error);
    process.exit(1);
  }
}

migrate();
