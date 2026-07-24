/**
 * Split paragraph-style module topics into individual points, preserving all
 * content. Seeded courses packed each topic as:
 *   "Heading — bullet1; bullet2; bullet3"
 * which renders as one run-on bullet. This turns it into separate points:
 *   ["Heading", "bullet1", "bullet2", "bullet3"]
 *
 * Split rule:
 *   - Split at the FIRST " — " (em dash U+2014, with spaces) → heading + rest.
 *     Only the em dash — NOT the en dash "–", which appears inside headings
 *     (e.g. "MS Word – Advanced Formatting").
 *   - Split `rest` on "; " into detail bullets.
 *   - No em dash but has "; " → split on "; ". Otherwise keep as-is (already clean).
 *
 * Idempotent (already-split topics have no " — " / "; ", so they pass through).
 *
 * Run from the backend folder:
 *   Dry run:  SEED_DRY=true node src/scripts/splitModuleTopics.js
 *   Apply:    node src/scripts/splitModuleTopics.js
 */
import "dotenv/config";
import mongoose from "mongoose";
import connectMongoDB from "../config/mongodb.js";
import { Module } from "../models/module.model.js";
import { bumpNs } from "../utils/cache.js";

const DRY = process.env.SEED_DRY === "true";

const EM_DASH_SEP = " — "; // space + em dash + space (the seed's heading/bullet separator)

// Split one topic string into its individual points. A string is only treated as
// a "Heading — b1; b2; ..." paragraph when it has BOTH the em-dash separator AND a
// "; " bullet list — so a single detail bullet that merely contains an em dash
// mid-sentence (e.g. "ElasticNet — hyperparameter selection with CV") is left
// intact, and re-running the migration is a safe no-op (idempotent).
const splitTopic = (raw) => {
  if (typeof raw !== "string") return [];
  const t = raw.trim();
  if (!t) return [];
  if (t.includes(EM_DASH_SEP) && t.includes("; ")) {
    const idx = t.indexOf(EM_DASH_SEP);
    const heading = t.slice(0, idx).trim();
    const bullets = t.slice(idx + EM_DASH_SEP.length).split(/;\s+/).map((s) => s.trim()).filter(Boolean);
    return [heading, ...bullets].filter(Boolean);
  }
  if (t.includes("; ")) return t.split(/;\s+/).map((s) => s.trim()).filter(Boolean);
  return [t];
};

const splitTopics = (topics) => (topics || []).flatMap(splitTopic);

async function run() {
  await connectMongoDB();

  const mods = await Module.find({}).select("title topics").lean();
  const ops = [];
  let sampled = false;
  for (const m of mods) {
    const next = splitTopics(m.topics);
    const before = m.topics || [];
    if (next.length !== before.length || next.some((t, i) => t !== before[i])) {
      ops.push({ updateOne: { filter: { _id: m._id }, update: { $set: { topics: next } } } });
      if (DRY && !sampled) {
        sampled = true;
        console.log(`Sample — module "${m.title}":`);
        console.log(`  before (${before.length}):`);
        before.forEach((t) => console.log(`     • ${t}`));
        console.log(`  after (${next.length}):`);
        next.forEach((t) => console.log(`     • ${t}`));
      }
    }
  }

  console.log(`\n${ops.length} of ${mods.length} module(s) will have their topics split.`);

  if (DRY) {
    console.log("\n(dry run — no database changes)");
    await mongoose.disconnect();
    return;
  }

  if (ops.length) {
    await Module.bulkWrite(ops);
    await bumpNs("courses"); // invalidate cached catalog / course reads
  }
  console.log(`\n✅ Updated ${ops.length} module(s). Cache invalidated.`);
  await mongoose.disconnect();
  process.exit(0);
}

run().catch(async (e) => {
  console.error("Split failed:", e);
  try { await mongoose.disconnect(); } catch { /* ignore */ }
  process.exit(1);
});
