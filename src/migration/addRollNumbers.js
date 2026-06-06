// Migration: ensure users.roll_number and (re)assign every user a roll in the
// current scheme  FSA-<ROLE>-<YY>-<NNNN>.
//
// Run:  cd backend && npm run migrate:rolls
//
// Deterministic + idempotent: rolls are computed from each user's role and
// signup order, so re-running produces the same numbers. Safe to run after a
// scheme change to renumber existing users.

import "dotenv/config";

import pool from "../config/db.js";
import { roleCode, rollYear, formatRoll } from "../utils/roll.util.js";

async function migrate() {
  try {
    // 1. Ensure the column exists (no-op if already there)
    await pool.query(
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS roll_number VARCHAR(20) UNIQUE`
    );
    console.log("✓ roll_number column ensured");

    // 2. Assign in signup order so each role/year sequence matches join order
    const { rows: users } = await pool.query(
      `SELECT id, role, created_at FROM users
        ORDER BY created_at ASC, id ASC`
    );

    if (users.length === 0) {
      console.log("✓ No users to assign");
      process.exit(0);
    }

    const counters = {}; // `${CODE}-${YY}` → last sequence used
    let count = 0;

    for (const u of users) {
      const date = new Date(u.created_at);
      const key = `${roleCode(u.role)}-${rollYear(date)}`;
      counters[key] = (counters[key] || 0) + 1;
      const roll = formatRoll(u.role, date, counters[key]);
      await pool.query(`UPDATE users SET roll_number = $1 WHERE id = $2`, [roll, u.id]);
      count++;
    }

    console.log(`✓ Assigned role+year roll numbers to ${count} user(s)`);
    process.exit(0);
  } catch (error) {
    console.error("Roll-number migration failed:");
    console.error(error);
    process.exit(1);
  }
}

migrate();
