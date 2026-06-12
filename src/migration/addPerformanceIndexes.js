// Migration: add the indexes the hot read paths actually need.
//
// The earlier migrations indexed the affiliate tables but never the `users`
// columns we filter/search on every request:
//   - WHERE role = 'student'           (every student listing / broadcast)
//   - WHERE email = $1                 (login / register existence check)
//   - ILIKE on full_name/email/roll_number (admin search boxes)
// plus the foreign-key-ish columns on payments/commissions.
//
// Run:  cd backend && npm run migrate:indexes
//
// Idempotent — every statement uses IF NOT EXISTS. Indexes are built
// CONCURRENTLY so they don't take a write lock on a live table; that means each
// runs in its own statement (node-pg auto-commits, no surrounding transaction).

import "dotenv/config";
import pool from "../config/db.js";

async function migrate() {
  try {
    // Trigram extension powers fast ILIKE '%term%' search. Supported on Neon.
    await pool.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
    console.log("✓ pg_trgm extension ready");

    const statements = [
      // ── users ────────────────────────────────────────────────────────────
      // Role filter (students are the bulk of rows but still worth narrowing).
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_role ON users (role)`,
      // Case-insensitive / substring search used by the admin lists.
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_fullname_trgm ON users USING gin (full_name gin_trgm_ops)`,
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_email_trgm ON users USING gin (email gin_trgm_ops)`,
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_roll_trgm ON users USING gin (roll_number gin_trgm_ops)`,
      // Affiliate referral resolution (users.referred_by -> referrer).
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_referred_by ON users (referred_by)`,

      // ── payments ─────────────────────────────────────────────────────────
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payments_user_id ON payments (user_id)`,
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payments_status ON payments (status)`,

      // ── commissions ──────────────────────────────────────────────────────
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_commissions_affiliate ON commissions (affiliate_user_id)`,
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_commissions_referred ON commissions (referred_user_id)`,
    ];

    for (const sql of statements) {
      await pool.query(sql);
      console.log("✓", sql.match(/idx_\w+/)[0]);
    }

    console.log("✅ performance indexes ready");
    process.exit(0);
  } catch (error) {
    console.error("Performance-index migration failed:");
    console.error(error);
    process.exit(1);
  }
}

migrate();
