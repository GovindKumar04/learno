// Migration: create the payments + affiliate-program tables.
//
// These used to run on every server boot inside server.js. Moved here so the
// server starts fast and schema changes are explicit. (users table is created
// by seed.js.)
//
// Run:  cd backend && npm run migrate:tables
//
// Idempotent — CREATE TABLE / ADD COLUMN / CREATE INDEX all use IF NOT EXISTS,
// so it is safe to re-run.

import "dotenv/config";
import pool from "../config/db.js";

async function migrate() {
  try {
    // ── Payments ──────────────────────────────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS payments (
        id SERIAL PRIMARY KEY,
        user_id UUID NOT NULL,
        course_id VARCHAR(24) NOT NULL,
        course_title TEXT NOT NULL,
        enrollment_type VARCHAR(20) NOT NULL DEFAULT 'self-paced',
        amount INTEGER NOT NULL,
        currency VARCHAR(5) NOT NULL DEFAULT 'INR',
        razorpay_order_id VARCHAR(100) UNIQUE NOT NULL,
        razorpay_payment_id VARCHAR(100),
        razorpay_signature TEXT,
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        paid_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log("✓ payments table ready");

    // ── Affiliate program ───────────────────────────────────────────────────────
    // Affiliate referral link captured at signup.
    // NOTE: users.id is BIGINT in this database, so all user references use BIGINT.
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by BIGINT`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS affiliates (
        id SERIAL PRIMARY KEY,
        user_id BIGINT UNIQUE NOT NULL,
        code VARCHAR(20) UNIQUE NOT NULL,
        commission_type VARCHAR(10) NOT NULL DEFAULT 'percent',
        commission_value NUMERIC(10,2) NOT NULL DEFAULT 10,
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        clicks INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS commissions (
        id SERIAL PRIMARY KEY,
        affiliate_user_id BIGINT NOT NULL,
        referred_user_id BIGINT NOT NULL,
        payment_id INTEGER NOT NULL,
        course_title TEXT NOT NULL,
        sale_amount INTEGER NOT NULL,
        commission_amount INTEGER NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT NOW(),
        paid_at TIMESTAMP
      )
    `);

    // Affiliate profile fields (bio + social handles), carried over from the
    // approved application onto the affiliate record.
    await pool.query(`ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS bio TEXT`);
    await pool.query(`ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS social_links JSONB NOT NULL DEFAULT '[]'`);

    // Third-party applications to join the affiliate program. Applicants have
    // no account yet — on approval an affiliate-role user is created and linked
    // via user_id. status: pending | approved | rejected.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS affiliate_applications (
        id SERIAL PRIMARY KEY,
        full_name VARCHAR(100) NOT NULL,
        email VARCHAR(255) NOT NULL,
        phone VARCHAR(20),
        bio TEXT,
        social_links JSONB NOT NULL DEFAULT '[]',
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        review_note TEXT,
        user_id BIGINT,
        reviewed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    // Prevent duplicate open applications from the same email
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uniq_pending_application_email
      ON affiliate_applications (lower(email)) WHERE status = 'pending'
    `);

    // Resources (e.g. Google Drive links) the admin shares with all affiliates
    await pool.query(`
      CREATE TABLE IF NOT EXISTS affiliate_resources (
        id SERIAL PRIMARY KEY,
        title VARCHAR(200) NOT NULL,
        description TEXT,
        url TEXT NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log("✓ affiliate tables ready");

    process.exit(0);
  } catch (error) {
    console.error("Payments/affiliate migration failed:");
    console.error(error);
    process.exit(1);
  }
}

migrate();
