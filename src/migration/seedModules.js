import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
import connectMongoDB from "../config/mongodb.js";
import { Course } from "../models/course.model.js";
import { Module } from "../models/module.model.js";

// Seeds the `modules` collection from a MongoDB extended-JSON export and relinks
// each referenced course's `modules` array. Idempotent: modules are upserted by
// their _id, so re-running won't create duplicates.
//
// Usage:
//   npm run seed:modules                 # uses the bundled data/FILLIP.modules.json
//   node src/migration/seedModules.js <path-to-json>

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = process.argv[2] || path.join(__dirname, "data", "FILLIP.modules.json");

// Recursively convert Mongo extended-JSON ({ $oid }, { $date }) into real types.
function reviveEJSON(value) {
  if (Array.isArray(value)) return value.map(reviveEJSON);
  if (value && typeof value === "object") {
    const keys = Object.keys(value);
    if (keys.length === 1 && keys[0] === "$oid") return new mongoose.Types.ObjectId(value.$oid);
    if (keys.length === 1 && keys[0] === "$date") return new Date(value.$date);
    const out = {};
    for (const k of keys) out[k] = reviveEJSON(value[k]);
    return out;
  }
  return value;
}

async function run() {
  if (!fs.existsSync(SOURCE)) {
    console.error(`❌ Source file not found: ${SOURCE}`);
    process.exit(1);
  }

  console.log(`⏳ Reading ${SOURCE}`);
  const raw = JSON.parse(fs.readFileSync(SOURCE, "utf-8"));
  const docs = reviveEJSON(Array.isArray(raw) ? raw : [raw]);
  console.log(`   ${docs.length} module(s) in file`);

  await connectMongoDB();

  // Upsert each module by _id (replace so re-running stays clean)
  const ops = docs.map((d) => ({
    replaceOne: {
      filter: { _id: d._id },
      replacement: {
        title: d.title,
        description: d.description || "",
        course: d.course,
        order: d.order ?? 0,
        topics: d.topics || [],
        skills: d.skills || [],
        project: d.project || "",
        materials: d.materials || [],
        createdAt: d.createdAt || new Date(),
        updatedAt: d.updatedAt || new Date(),
      },
      upsert: true,
    },
  }));

  const result = await Module.bulkWrite(ops, { ordered: false });
  console.log(`✅ Modules: ${result.upsertedCount || 0} inserted, ${result.modifiedCount || 0} updated`);

  // Relink each referenced course's `modules` array (sorted by order)
  const byCourse = new Map();
  for (const d of docs) {
    const cid = d.course.toString();
    if (!byCourse.has(cid)) byCourse.set(cid, []);
    byCourse.get(cid).push({ _id: d._id, order: d.order ?? 0 });
  }

  let linked = 0;
  let missing = 0;
  for (const [cid, mods] of byCourse) {
    const course = await Course.findById(cid).select("_id title");
    if (!course) {
      missing += 1;
      console.warn(`   ⚠️  course ${cid} not found — ${mods.length} module(s) left unlinked`);
      continue;
    }
    const ids = mods.sort((a, b) => a.order - b.order).map((m) => m._id);
    await Course.updateOne({ _id: cid }, { $set: { modules: ids } });
    linked += 1;
    console.log(`   ↳ ${course.title}: linked ${ids.length} module(s)`);
  }

  console.log(`\n✅ Done — ${linked} course(s) linked${missing ? `, ${missing} course(s) missing (modules imported but not linked)` : ""}.`);
  await mongoose.connection.close();
  process.exit(0);
}

run().catch(async (err) => {
  console.error("❌ Seed failed:", err);
  try { await mongoose.connection.close(); } catch { /* ignore */ }
  process.exit(1);
});
