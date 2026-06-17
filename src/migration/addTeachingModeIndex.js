import "dotenv/config";

import mongoose from "mongoose";
import connectMongoDB from "../config/mongodb.js";
import { TeachingRequest } from "../models/teachingRequest.model.js";

// ─────────────────────────────────────────────────────────────────────────────
// Teaching requests moved from one-per-(instructor, course) to one-per-(instructor,
// course, mode) so an instructor can apply to teach a course in several modes
// (self-paced / classroom / live) via separate requests.
//
// The old unique index {instructorId:1, courseId:1} would block that second
// request, so drop it. Mongoose recreates the new compound index on boot.
// Idempotent: skips if the old index is already gone.
// ─────────────────────────────────────────────────────────────────────────────
const run = async () => {
  await connectMongoDB();

  const coll = TeachingRequest.collection;
  const indexes = await coll.indexes();
  const old = indexes.find(
    (ix) => ix.key && ix.key.instructorId === 1 && ix.key.courseId === 1 && ix.key.mode === undefined
  );

  if (old) {
    await coll.dropIndex(old.name);
    console.log(`Dropped old teaching-request index "${old.name}".`);
  } else {
    console.log("Old teaching-request index not present — skipping.");
  }

  // Recreate the model's current indexes (the new {instructorId, courseId, mode}).
  await TeachingRequest.syncIndexes();
  console.log("Synced teaching-request indexes.");

  await mongoose.disconnect();
  console.log("Done.");
  process.exit(0);
};

run().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
