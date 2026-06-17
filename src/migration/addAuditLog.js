// Migration: append-only audit_log for privileged/sensitive actions.
//
// Records WHO did WHAT to WHICH target, plus a sanitized request snapshot and
// the client IP. Written fire-and-forget by audit.middleware.js on the sensitive
// admin routes (enroll/unenroll, broadcast, direct mail, certificate issue,
// affiliate review/commission changes).
//
// Run:  cd backend && npm run migrate:audit
//
// Idempotent — IF NOT EXISTS everywhere.

import "dotenv/config";
import pool from "../config/db.js";

async function migrate() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        actor_id    UUID,                   -- users.id (null for unauthenticated)
        actor_role  VARCHAR(20),
        action      VARCHAR(60) NOT NULL,   -- e.g. enrollment.create, mail.send
        target_id   TEXT,                   -- PG id or Mongo ObjectId, as a string
        metadata    JSONB,                  -- sanitized params/body snapshot
        ip          VARCHAR(64),
        created_at  TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log("✓ audit_log table ready");

    await pool.query(`CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log (created_at DESC)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON audit_log (actor_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log (action)`);
    console.log("✓ audit_log indexes ready");

    console.log("✅ audit log migration complete");
    process.exit(0);
  } catch (error) {
    console.error("Audit-log migration failed:");
    console.error(error);
    process.exit(1);
  }
}

migrate();
