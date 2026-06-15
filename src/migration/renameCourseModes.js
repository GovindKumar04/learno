import "dotenv/config";

import mongoose from "mongoose";
import connectMongoDB from "../config/mongodb.js";
import pool from "../config/db.js";
import { Course } from "../models/course.model.js";
import { Enrollment } from "../models/enrollment.model.js";
import { Batch } from "../models/batch.model.js";
import { TeachingRequest } from "../models/teachingRequest.model.js";
import { Attendance } from "../models/attendance.model.js";

// ─────────────────────────────────────────────────────────────────────────────
// Renames the legacy delivery-mode keys to the new three-type scheme:
//   online  → self-paced
//   offline → classroom
//   (live is brand new — nothing to migrate for it)
//
// Applies to Course.modes (array) and Enrollment.enrollmentType (scalar).
// Idempotent: values that are already migrated pass through unchanged, so it is
// safe to run more than once. Uses updateMany (no schema validation) so the
// old enum values can be rewritten even though the schema no longer allows them.
// ─────────────────────────────────────────────────────────────────────────────
const run = async () => {
  await connectMongoDB();

  // Course.modes: map each array element through online→self-paced, offline→classroom.
  const courseRes = await Course.updateMany({}, [
    {
      $set: {
        modes: {
          $map: {
            input: { $ifNull: ["$modes", []] },
            as: "m",
            in: {
              $switch: {
                branches: [
                  { case: { $eq: ["$$m", "online"] }, then: "self-paced" },
                  { case: { $eq: ["$$m", "offline"] }, then: "classroom" },
                ],
                default: "$$m",
              },
            },
          },
        },
      },
    },
  ]);
  console.log(`Courses scanned: ${courseRes.matchedCount}, modified: ${courseRes.modifiedCount}`);

  // Enrollment.enrollmentType: scalar swaps.
  const selfPaced = await Enrollment.updateMany({ enrollmentType: "online" }, { $set: { enrollmentType: "self-paced" } });
  const classroom = await Enrollment.updateMany({ enrollmentType: "offline" }, { $set: { enrollmentType: "classroom" } });
  console.log(`Enrollments online→self-paced: ${selfPaced.modifiedCount}, offline→classroom: ${classroom.modifiedCount}`);

  // Batch.mode: only ever "offline" → "classroom".
  const batchRes = await Batch.updateMany({ mode: "offline" }, { $set: { mode: "classroom" } });
  console.log(`Batches offline→classroom: ${batchRes.modifiedCount}`);

  // TeachingRequest.mode: "offline" → "classroom".
  const trRes = await TeachingRequest.updateMany({ mode: "offline" }, { $set: { mode: "classroom" } });
  console.log(`Teaching requests offline→classroom: ${trRes.modifiedCount}`);

  // The attendance batchId+date index changed from plain-unique to partial (so
  // live docs without a batchId don't collide). Drop the old one so Mongoose can
  // recreate it with the new options on next boot. Ignore if it's already gone.
  try {
    await Attendance.collection.dropIndex("batchId_1_date_1");
    console.log("Dropped old attendance index batchId_1_date_1 (will be recreated as partial).");
  } catch {
    console.log("Old attendance index batchId_1_date_1 not present — skipping.");
  }

  // Postgres `payments` table: widen enrollment_type, fix default, migrate rows.
  // "self-paced" is 10 chars and barely fit VARCHAR(10) — widen for safety.
  await pool.query(`ALTER TABLE payments ALTER COLUMN enrollment_type TYPE VARCHAR(20)`);
  await pool.query(`ALTER TABLE payments ALTER COLUMN enrollment_type SET DEFAULT 'self-paced'`);
  const pgSelf = await pool.query(`UPDATE payments SET enrollment_type = 'self-paced' WHERE enrollment_type = 'online'`);
  const pgClass = await pool.query(`UPDATE payments SET enrollment_type = 'classroom' WHERE enrollment_type = 'offline'`);
  console.log(`Payments online→self-paced: ${pgSelf.rowCount}, offline→classroom: ${pgClass.rowCount}`);

  await mongoose.disconnect();
  await pool.end();
  console.log("Done.");
  process.exit(0);
};

run().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
