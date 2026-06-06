// Import courses from a MongoDB Extended JSON export into the `courses`
// collection. Handles $oid / $date via EJSON, and upserts by _id so it's
// idempotent (safe to re-run; existing courses are replaced, not duplicated).
//
// Usage:
//   node src/migration/importCourses.js "C:/path/to/FILLIP.courses.json"

import "dotenv/config";
import fs from "fs";
import { EJSON } from "bson";
import mongoose from "mongoose";
import connectMongoDB from "../config/mongodb.js";

const file = process.argv[2];

async function run() {
  if (!file) {
    console.error("Provide the JSON file path as an argument.");
    process.exit(1);
  }
  if (!fs.existsSync(file)) {
    console.error(`File not found: ${file}`);
    process.exit(1);
  }

  await connectMongoDB();

  // EJSON.parse converts { $oid } -> ObjectId and { $date } -> Date
  const raw = fs.readFileSync(file, "utf8");
  const docs = EJSON.parse(raw);
  const list = Array.isArray(docs) ? docs : [docs];

  if (list.length === 0) {
    console.log("Nothing to import.");
    process.exit(0);
  }

  const coll = mongoose.connection.collection("courses");
  const ops = list.map((d) => ({
    replaceOne: { filter: { _id: d._id }, replacement: d, upsert: true },
  }));

  const res = await coll.bulkWrite(ops, { ordered: false });
  console.log(
    `✓ Courses import done — upserted ${res.upsertedCount}, replaced ${res.modifiedCount}, matched ${res.matchedCount} (of ${list.length})`
  );
  process.exit(0);
}

run().catch((err) => {
  console.error("Course import failed:", err);
  process.exit(1);
});
