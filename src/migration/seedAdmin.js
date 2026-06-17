// Seed (or reset) an admin account with a properly bcrypt-hashed password.
//
//   cd backend && npm run seed:admin -- <email> <password> ["Full Name"]
//
// Lets the DB generate the id (works on both the uuid and legacy schemas).
// Upserts by email — re-running updates the password and ensures role=admin.

import "dotenv/config";
import bcrypt from "bcrypt";
import pool from "../config/db.js";
import { generateRollNumber } from "../utils/roll.util.js";

const [, , email, password, fullNameArg] = process.argv;
const fullName = fullNameArg || "Admin";

const run = async () => {
  if (!email || !password) {
    console.error('Usage: npm run seed:admin -- <email> <password> ["Full Name"]');
    process.exit(1);
  }
  const hashed = await bcrypt.hash(password, 10);

  // Try a few roll numbers in case of a UNIQUE collision.
  let inserted = null;
  for (let i = 0; i < 5; i++) {
    const roll = await generateRollNumber(pool, "admin");
    try {
      const res = await pool.query(
        `INSERT INTO users (full_name, email, roll_number, password, role, is_verified)
         VALUES ($1, $2, $3, $4, 'admin', true)
         ON CONFLICT (email) DO UPDATE
           SET password = EXCLUDED.password, role = 'admin', is_verified = true
         RETURNING id, email, role`,
        [fullName, email.trim().toLowerCase(), roll, hashed],
      );
      inserted = res.rows[0];
      break;
    } catch (err) {
      if (err.code === "23505" && err.constraint === "users_roll_number_key") continue;
      throw err;
    }
  }

  console.log("✅ Admin ready:", inserted);
  console.log(`   Log in at /admin/login with: ${email} / (the password you passed)`);
  await pool.end();
  process.exit(0);
};

run().catch((err) => { console.error("Seed admin failed:", err); process.exit(1); });
