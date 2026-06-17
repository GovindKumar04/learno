import "dotenv/config";

import mongoose from "mongoose";
import connectMongoDB from "../config/mongodb.js";
import pool from "../config/db.js";

import { Course } from "../models/course.model.js";
import { Module } from "../models/module.model.js";
import { Material } from "../models/material.model.js";
import { Batch } from "../models/batch.model.js";
import { OnlineClass } from "../models/onlineClass.model.js";
import { Enrollment } from "../models/enrollment.model.js";
import { Progress } from "../models/progress.model.js";
import { Attendance } from "../models/attendance.model.js";
import { Certificate } from "../models/certificate.model.js";

// ─────────────────────────────────────────────────────────────────────────────
// Orphan scanner for the split-brain DB (Postgres users + Mongo content).
//
//   node src/migration/findOrphans.js            → REPORT ONLY (default, safe)
//   node src/migration/findOrphans.js --delete   → actually delete the structural
//                                                   orphans (asks nothing — only run
//                                                   after reviewing the report!)
//
// "Structural" orphans = a doc whose required parent no longer exists. We DO NOT
// delete user-based orphans automatically (cross-DB id matching is risky) — those
// are reported for manual review only.
// ─────────────────────────────────────────────────────────────────────────────
const DELETE = process.argv.includes("--delete");

const toIdSet = (arr) => new Set(arr.map((x) => String(x)));

const run = async () => {
  await connectMongoDB();

  // Valid parent id sets.
  const [courseIds, moduleIds, batchIds, onlineClassIds] = await Promise.all([
    Course.distinct("_id"),
    Module.distinct("_id"),
    Batch.distinct("_id"),
    OnlineClass.distinct("_id"),
  ]);
  const courseSet = toIdSet(courseIds);
  const moduleSet = toIdSet(moduleIds);
  const batchSet = toIdSet(batchIds);
  const onlineClassSet = toIdSet(onlineClassIds);

  const usersRes = await pool.query("SELECT id FROM users");
  const userSet = toIdSet(usersRes.rows.map((r) => r.id));

  console.log("\n── Valid parents ──");
  console.log(`courses=${courseSet.size} modules=${moduleSet.size} batches=${batchSet.size} liveClasses=${onlineClassSet.size} users=${userSet.size}`);

  // Helper: scan a collection, return orphan _ids by a predicate.
  const scan = async (Model, label, predicate) => {
    const docs = await Model.find({}).lean();
    const orphans = docs.filter(predicate);
    return { label, total: docs.length, orphans };
  };

  // ── Structural orphans (safe to delete: parent gone) ───────────────────────
  const structural = [
    await scan(Module, "Modules (course missing)", (d) => !courseSet.has(String(d.course))),
    await scan(Material, "Materials (module missing)", (d) => !moduleSet.has(String(d.module))),
    await scan(Enrollment, "Enrollments (course missing)", (d) => !courseSet.has(String(d.courseId))),
    await scan(Progress, "Progress (course missing)", (d) => !courseSet.has(String(d.courseId))),
    await scan(Batch, "Batches (course missing)", (d) => !courseSet.has(String(d.courseId))),
    await scan(OnlineClass, "Live classes (course missing)", (d) => !courseSet.has(String(d.courseId))),
    await scan(Attendance, "Attendance (batch missing)", (d) => d.batchId && !batchSet.has(String(d.batchId))),
    await scan(Attendance, "Attendance (live class missing)", (d) => d.onlineClassId && !onlineClassSet.has(String(d.onlineClassId))),
    await scan(Certificate, "Certificates (course missing)", (d) => !courseSet.has(String(d.courseId))),
  ];

  // ── User-based orphans (REPORT ONLY — never auto-deleted) ──────────────────
  const userBased = [
    await scan(Enrollment, "Enrollments (user missing)", (d) => !userSet.has(String(d.userId))),
    await scan(Progress, "Progress (user missing)", (d) => !userSet.has(String(d.userId))),
    await scan(Certificate, "Certificates (user missing)", (d) => !userSet.has(String(d.userId))),
  ];

  // ── Fixable (not deletable): stale OnlineClass.batchId ─────────────────────
  const staleBatchLinks = (await OnlineClass.find({ batchId: { $ne: null } }).lean())
    .filter((c) => !batchSet.has(String(c.batchId)));

  console.log("\n── Structural orphans (safe to delete) ──");
  structural.forEach((s) => console.log(`${s.orphans.length.toString().padStart(5)} / ${s.total}\t${s.label}`));

  console.log("\n── User-based orphans (REVIEW ONLY — not auto-deleted) ──");
  userBased.forEach((s) => console.log(`${s.orphans.length.toString().padStart(5)} / ${s.total}\t${s.label}`));

  console.log("\n── Fixable links (not deletable) ──");
  console.log(`${staleBatchLinks.length.toString().padStart(5)}\tLive classes pointing at a deleted batch (batchId should be cleared)`);

  if (!DELETE) {
    console.log("\nREPORT ONLY — nothing was changed. Re-run with --delete to remove the structural orphans above.\n");
    await mongoose.disconnect();
    await pool.end();
    process.exit(0);
  }

  // ── Deletion (only structural orphans; user-based left untouched) ──────────
  console.log("\n── Deleting structural orphans ──");
  const delById = async (Model, ids) => (ids.length ? (await Model.deleteMany({ _id: { $in: ids } })).deletedCount : 0);
  for (const s of structural) {
    const ids = s.orphans.map((o) => o._id);
    const n = await delById(s.label.startsWith("Modules") ? Module
      : s.label.startsWith("Materials") ? Material
      : s.label.startsWith("Enrollments") ? Enrollment
      : s.label.startsWith("Progress") ? Progress
      : s.label.startsWith("Batches") ? Batch
      : s.label.startsWith("Live classes") ? OnlineClass
      : s.label.startsWith("Attendance") ? Attendance
      : Certificate, ids);
    console.log(`deleted ${n}\t${s.label}`);
  }
  // Clear stale batch links rather than deleting the class.
  if (staleBatchLinks.length) {
    const r = await OnlineClass.updateMany(
      { _id: { $in: staleBatchLinks.map((c) => c._id) } },
      { $set: { batchId: null } },
    );
    console.log(`cleared batchId on ${r.modifiedCount} live class(es)`);
  }

  await mongoose.disconnect();
  await pool.end();
  console.log("\nDone.\n");
  process.exit(0);
};

run().catch((err) => {
  console.error("Orphan scan failed:", err);
  process.exit(1);
});
