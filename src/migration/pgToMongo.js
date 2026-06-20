// One-time data migration: copy every Postgres table into its new Mongoose
// collection, preserving UUIDs (→ _id), timestamps, and JSON fields.
//
//   cd backend && node src/migration/pgToMongo.js
//
// Idempotent: each row is upserted by _id, so re-running reconciles instead of
// duplicating. Postgres is read-only here — nothing is modified or dropped, so
// it stays intact as a backup until you decommission it.
//
// Requires both DATABASE_URL (Postgres/Neon) and MONGODB_URI in .env.

import "dotenv/config";
import mongoose from "mongoose";
import pool from "../config/db.js";
import connectMongoDB from "../config/mongodb.js";

import { User } from "../models/user.model.js";
import { Payment } from "../models/payment.model.js";
import { Affiliate } from "../models/affiliate.model.js";
import { Commission } from "../models/commission.model.js";
import { AffiliateApplication } from "../models/affiliateApplication.model.js";
import { AffiliateResource } from "../models/affiliateResource.model.js";
import { AuditLog } from "../models/auditLog.model.js";

// Move the SQL `id` column into Mongo's `_id`; everything else copies across.
const remapId = (row) => {
  const { id, ...rest } = row;
  return { _id: id, ...rest };
};

// One table → one model. `transform` adapts row shapes where the column types
// don't map 1:1 (NUMERIC → Number, social_links default, etc.).
const TABLES = [
  {
    name: "users",
    Model: User,
    sql: "SELECT * FROM users",
    transform: remapId,
  },
  {
    name: "payments",
    Model: Payment,
    sql: "SELECT * FROM payments",
    transform: remapId,
  },
  {
    name: "affiliates",
    Model: Affiliate,
    sql: "SELECT * FROM affiliates",
    transform: (row) => {
      const doc = remapId(row);
      doc.commission_value = Number(doc.commission_value);
      doc.social_links = Array.isArray(doc.social_links) ? doc.social_links : [];
      return doc;
    },
  },
  {
    name: "commissions",
    Model: Commission,
    sql: "SELECT * FROM commissions",
    transform: remapId,
  },
  {
    name: "affiliate_applications",
    Model: AffiliateApplication,
    sql: "SELECT * FROM affiliate_applications",
    transform: (row) => {
      const doc = remapId(row);
      doc.social_links = Array.isArray(doc.social_links) ? doc.social_links : [];
      return doc;
    },
  },
  {
    name: "affiliate_resources",
    Model: AffiliateResource,
    sql: "SELECT * FROM affiliate_resources",
    transform: remapId,
  },
  {
    name: "audit_log",
    Model: AuditLog,
    sql: "SELECT * FROM audit_log",
    transform: remapId,
  },
];

const tableExists = async (name) => {
  const { rows } = await pool.query("SELECT to_regclass($1) AS r", [`public.${name}`]);
  return !!rows[0].r;
};

const migrateTable = async ({ name, Model, sql, transform }) => {
  if (!(await tableExists(name))) {
    console.log(`• ${name}: table not found in Postgres — skipping.`);
    return { name, copied: 0, skipped: true };
  }

  const { rows } = await pool.query(sql);
  if (rows.length === 0) {
    console.log(`• ${name}: 0 rows.`);
    return { name, copied: 0 };
  }

  // Upsert by _id so re-runs reconcile rather than duplicate.
  const ops = rows.map((row) => {
    const doc = transform(row);
    return {
      updateOne: {
        filter: { _id: doc._id },
        update: { $set: doc },
        upsert: true,
      },
    };
  });

  const res = await Model.bulkWrite(ops, { ordered: false });
  const written = (res.upsertedCount || 0) + (res.modifiedCount || 0);
  console.log(`• ${name}: ${rows.length} rows → ${written} written (${res.upsertedCount || 0} new, ${res.modifiedCount || 0} updated).`);
  return { name, copied: written };
};

const run = async () => {
  console.log("⏳ Connecting to Postgres + MongoDB...");
  await pool.query("SELECT 1");
  await connectMongoDB();
  console.log("✅ Connected. Starting copy (Postgres is read-only, nothing dropped).\n");

  const results = [];
  for (const table of TABLES) {
    try {
      results.push(await migrateTable(table));
    } catch (err) {
      console.error(`❌ ${table.name} failed:`, err.message);
      throw err;
    }
  }

  console.log("\n✅ Migration complete.");
  console.table(results);

  await pool.end();
  await mongoose.connection.close();
  process.exit(0);
};

run().catch(async (err) => {
  console.error("\n❌ Migration failed:", err);
  try { await pool.end(); } catch { /* ignore */ }
  try { await mongoose.connection.close(); } catch { /* ignore */ }
  process.exit(1);
});
