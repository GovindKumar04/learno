// Authoritative Postgres schema for Fillip — UUID primary keys throughout.
//
//   cd backend && npm run db:init
//
// Idempotent (IF NOT EXISTS everywhere) so it's safe to re-run. This is the single
// source of truth for the PG schema and supersedes the older seed.js. The app
// supplies a UUIDv7 on insert (see utils/id.util.js); the gen_random_uuid()
// column defaults are only a fallback. `role` is VARCHAR (not an enum) so the
// 'affiliate' role works alongside student/instructor/admin.

import "dotenv/config";
import pool from "../config/db.js";

const SQL = [
  `CREATE EXTENSION IF NOT EXISTS "pgcrypto"`,

  // ── users ──────────────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS users (
     id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     full_name                 VARCHAR(100) NOT NULL,
     email                     VARCHAR(255) UNIQUE NOT NULL,
     roll_number               VARCHAR(20) UNIQUE,
     password                  TEXT,
     role                      VARCHAR(20) NOT NULL DEFAULT 'student',
     location                  VARCHAR(255),
     phone                     VARCHAR(20),
     refresh_token             TEXT,
     avatar                    TEXT,
     is_verified               BOOLEAN DEFAULT false,
     is_active                 BOOLEAN DEFAULT true,
     referred_by               UUID,
     verification_code         TEXT,
     verification_code_expires TIMESTAMP,
     reset_code                TEXT,
     reset_code_expires        TIMESTAMP,
     google_id                 TEXT,
     created_at                TIMESTAMP DEFAULT NOW(),
     updated_at                TIMESTAMP DEFAULT NOW()
   )`,

  // ── payments ─────────────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS payments (
     id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     user_id             UUID NOT NULL,
     course_id           VARCHAR(24) NOT NULL,
     course_title        TEXT NOT NULL,
     enrollment_type     VARCHAR(20) NOT NULL DEFAULT 'self-paced',
     amount              INTEGER NOT NULL,
     currency            VARCHAR(5) NOT NULL DEFAULT 'INR',
     razorpay_order_id   VARCHAR(100) UNIQUE NOT NULL,
     razorpay_payment_id VARCHAR(100),
     razorpay_signature  TEXT,
     status              VARCHAR(20) NOT NULL DEFAULT 'pending',
     paid_at             TIMESTAMP,
     created_at          TIMESTAMP DEFAULT NOW(),
     updated_at          TIMESTAMP DEFAULT NOW()
   )`,

  // ── affiliate program ────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS affiliates (
     id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     user_id          UUID UNIQUE NOT NULL,
     code             VARCHAR(20) UNIQUE NOT NULL,
     commission_type  VARCHAR(10) NOT NULL DEFAULT 'percent',
     commission_value NUMERIC(10,2) NOT NULL DEFAULT 10,
     status           VARCHAR(20) NOT NULL DEFAULT 'active',
     clicks           INTEGER NOT NULL DEFAULT 0,
     bio              TEXT,
     social_links     JSONB NOT NULL DEFAULT '[]',
     created_at       TIMESTAMP DEFAULT NOW(),
     updated_at       TIMESTAMP DEFAULT NOW()
   )`,

  `CREATE TABLE IF NOT EXISTS commissions (
     id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     affiliate_user_id UUID NOT NULL,
     referred_user_id  UUID NOT NULL,
     payment_id        UUID NOT NULL,
     course_title      TEXT NOT NULL,
     sale_amount       INTEGER NOT NULL,
     commission_amount INTEGER NOT NULL,
     status            VARCHAR(20) NOT NULL DEFAULT 'pending',
     created_at        TIMESTAMP DEFAULT NOW(),
     paid_at           TIMESTAMP
   )`,

  `CREATE TABLE IF NOT EXISTS affiliate_applications (
     id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     full_name    VARCHAR(100) NOT NULL,
     email        VARCHAR(255) NOT NULL,
     phone        VARCHAR(20),
     bio          TEXT,
     social_links JSONB NOT NULL DEFAULT '[]',
     status       VARCHAR(20) NOT NULL DEFAULT 'pending',
     review_note  TEXT,
     user_id      UUID,
     reviewed_at  TIMESTAMP,
     created_at   TIMESTAMP DEFAULT NOW()
   )`,

  `CREATE UNIQUE INDEX IF NOT EXISTS uniq_pending_application_email
     ON affiliate_applications (lower(email)) WHERE status = 'pending'`,

  `CREATE TABLE IF NOT EXISTS affiliate_resources (
     id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     title       VARCHAR(200) NOT NULL,
     description TEXT,
     url         TEXT NOT NULL,
     is_active   BOOLEAN NOT NULL DEFAULT true,
     created_at  TIMESTAMP DEFAULT NOW(),
     updated_at  TIMESTAMP DEFAULT NOW()
   )`,

  // ── audit log ──────────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS audit_log (
     id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     actor_id   UUID,
     actor_role VARCHAR(20),
     action     VARCHAR(60) NOT NULL,
     target_id  TEXT,
     metadata   JSONB,
     ip         VARCHAR(64),
     created_at TIMESTAMP DEFAULT NOW()
   )`,

  // ── core indexes ─────────────────────────────────────────────────────────────
  `CREATE INDEX IF NOT EXISTS idx_users_role ON users (role)`,
  `CREATE INDEX IF NOT EXISTS idx_users_referred_by ON users (referred_by)`,
  `CREATE INDEX IF NOT EXISTS idx_payments_user_id ON payments (user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_payments_status ON payments (status)`,
  `CREATE INDEX IF NOT EXISTS idx_payments_created_at ON payments (created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_commissions_affiliate ON commissions (affiliate_user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_commissions_referred ON commissions (referred_user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log (created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON audit_log (actor_id)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log (action)`,
];

// Tables this script owns. They're dropped + recreated with UUID PKs — but ONLY
// when empty, so we never destroy real data. Pass --force to override (dangerous).
const TABLES = ["commissions", "payments", "affiliates", "affiliate_applications", "affiliate_resources", "audit_log", "users"];
const FORCE = process.argv.includes("--force");

const run = async () => {
  // Safety: refuse to drop any table that still holds rows.
  const nonEmpty = [];
  for (const t of TABLES) {
    const exists = await pool.query("SELECT to_regclass($1) AS r", [`public.${t}`]);
    if (!exists.rows[0].r) continue;
    const c = await pool.query(`SELECT COUNT(*)::int AS n FROM "${t}"`);
    if (c.rows[0].n > 0) nonEmpty.push(`${t} (${c.rows[0].n} rows)`);
  }
  if (nonEmpty.length && !FORCE) {
    console.error(`\n⛔ Refusing to drop — these tables still have data: ${nonEmpty.join(", ")}.`);
    console.error("   Back up / clear them first, or re-run with --force to drop anyway.\n");
    await pool.end();
    process.exit(1);
  }

  // Drop (FK-free, so order is irrelevant) then recreate with UUID.
  for (const t of TABLES) await pool.query(`DROP TABLE IF EXISTS "${t}" CASCADE`);
  for (const stmt of SQL) await pool.query(stmt);

  console.log("✅ Postgres schema recreated with UUID primary keys.");
  await pool.end();
  process.exit(0);
};

run().catch((err) => {
  console.error("Schema creation failed:", err);
  process.exit(1);
});
