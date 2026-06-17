// Remove MongoDB records that still reference the OLD (pre-UUID-migration) bigint
// user ids. After the Postgres rebuild those users no longer exist, so these are
// orphans. Courses / modules / materials are NOT touched (only stray reviews are
// pruned). Run:  cd backend && npm run clean:legacy
//
// Idempotent — re-running just finds nothing left.

import "dotenv/config";
import mongoose from "mongoose";
import connectMongoDB from "../config/mongodb.js";
import { Enrollment } from "../models/enrollment.model.js";
import { Progress } from "../models/progress.model.js";
import { Certificate } from "../models/certificate.model.js";
import { Attendance } from "../models/attendance.model.js";
import { Batch } from "../models/batch.model.js";
import { OnlineClass } from "../models/onlineClass.model.js";
import { TeachingRequest } from "../models/teachingRequest.model.js";
import { Course } from "../models/course.model.js";

// A value that is NOT a valid UUID → legacy bigint ref to delete.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const notUuid = { $not: UUID };

const run = async () => {
  await connectMongoDB();

  // Whole docs keyed on a single user ref → delete when that ref is legacy.
  const enr  = await Enrollment.deleteMany({ userId: notUuid });
  const prog = await Progress.deleteMany({ userId: notUuid });
  const cert = await Certificate.deleteMany({ userId: notUuid });
  const tr   = await TeachingRequest.deleteMany({ instructorId: notUuid });
  const oc   = await OnlineClass.deleteMany({ instructorId: notUuid });
  const bat  = await Batch.deleteMany({ instructorId: notUuid });
  // Attendance sessions marked by a legacy instructor are orphaned too.
  const att  = await Attendance.deleteMany({ markedBy: notUuid });

  // Prune legacy entries from surviving array/embedded fields.
  const batPull = await Batch.updateMany({}, { $pull: { studentIds: notUuid } });
  const attPull = await Attendance.updateMany({}, { $pull: { records: { studentId: notUuid } } });
  const revPull = await Course.updateMany({}, { $pull: { reviews: { userId: notUuid } } });

  console.log("Deleted legacy-ref docs:");
  console.log(`  enrollments=${enr.deletedCount} progress=${prog.deletedCount} certificates=${cert.deletedCount}`);
  console.log(`  teachingRequests=${tr.deletedCount} onlineClasses=${oc.deletedCount} batches=${bat.deletedCount} attendance=${att.deletedCount}`);
  console.log("Pruned legacy entries:");
  console.log(`  batch.studentIds modified=${batPull.modifiedCount} attendance.records modified=${attPull.modifiedCount} course.reviews modified=${revPull.modifiedCount}`);

  await mongoose.disconnect();
  console.log("Done.");
  process.exit(0);
};

run().catch((err) => { console.error("Cleanup failed:", err); process.exit(1); });
