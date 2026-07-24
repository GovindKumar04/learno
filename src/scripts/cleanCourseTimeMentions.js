/**
 * Remove redundant week/day time-mentions from course content:
 *   - duration:     "1 Month (4 Weeks)" → "1 Month",  "1 Week (6 Days)" → "1 Week"
 *   - description:  "...1-month (4-week) professional..." → "...1-month professional..."
 *   - module title: "Week 1 — Fundamentals" → "Fundamentals",  "Day 3 — Tools" → "Tools"
 *
 * Only the `duration` / `description` week-day PARENTHETICAL and the module-title
 * "Week N —" / "Day N —" PREFIX are touched — legitimate mentions of days/weeks
 * inside module topics (e.g. "30 days no activity") are left alone.
 *
 * Idempotent. Supersedes stripDayPrefix.js (also handles "Week N —").
 *
 * Run from the backend folder:
 *   Dry run:  SEED_DRY=true node src/scripts/cleanCourseTimeMentions.js
 *   Apply:    node src/scripts/cleanCourseTimeMentions.js
 */
import "dotenv/config";
import mongoose from "mongoose";
import connectMongoDB from "../config/mongodb.js";
import { Course } from "../models/course.model.js";
import { Module } from "../models/module.model.js";
import { bumpNs } from "../utils/cache.js";

const DRY = process.env.SEED_DRY === "true";

// A parenthetical whose contents mention a week or day, e.g. "(4 Weeks)", "(6 Days)",
// "(4-week)". The leading \s* also removes the space before it.
const WEEK_DAY_PAREN = /\s*\((?:[^)]*\b(?:week|day)s?\b[^)]*)\)/gi;
// A leading "Week N — " / "Day N — " module-title prefix.
const PERIOD_PREFIX = /^(?:week|day)\s+\d+\s*[—–-]\s*/i;

const clean = (s) => (typeof s === "string" ? s.replace(WEEK_DAY_PAREN, "").trim() : s);
const stripPrefix = (s) => (typeof s === "string" ? s.replace(PERIOD_PREFIX, "").trim() : s);

async function run() {
  await connectMongoDB();

  // ── Courses: duration + description ─────────────────────────────────────────
  const courses = await Course.find({}).select("title duration description").lean();
  const courseOps = [];
  let durChanged = 0, descChanged = 0;
  for (const c of courses) {
    const set = {};
    const nextDur = clean(c.duration);
    if (nextDur !== undefined && nextDur !== c.duration) { set.duration = nextDur; durChanged++; }
    const nextDesc = clean(c.description);
    if (nextDesc !== undefined && nextDesc !== c.description) { set.description = nextDesc; descChanged++; }
    if (Object.keys(set).length) {
      if (DRY && durChanged + descChanged <= 6) {
        if (set.duration) console.log(`  duration: "${c.duration}" → "${set.duration}"  (${c.title})`);
        if (set.description) console.log(`  desc:     …${(c.description.match(WEEK_DAY_PAREN) || [""])[0].trim()}… removed  (${c.title})`);
      }
      courseOps.push({ updateOne: { filter: { _id: c._id }, update: { $set: set } } });
    }
  }

  // ── Modules: strip "Week N —" / "Day N —" title prefix ──────────────────────
  const mods = await Module.find({ title: /^(?:Week|Day)\s+\d+/i }).select("title").lean();
  const modOps = [];
  let modChanged = 0;
  for (const m of mods) {
    const next = stripPrefix(m.title);
    if (next && next !== m.title) {
      modChanged++;
      if (DRY && modChanged <= 6) console.log(`  module:   "${m.title}" → "${next}"`);
      modOps.push({ updateOne: { filter: { _id: m._id }, update: { $set: { title: next } } } });
    }
  }

  console.log(`\nTo change → durations: ${durChanged}, descriptions: ${descChanged}, module titles: ${modChanged}`);

  if (DRY) {
    console.log("\n(dry run — no database changes)");
    await mongoose.disconnect();
    return;
  }

  if (courseOps.length) await Course.bulkWrite(courseOps);
  if (modOps.length) await Module.bulkWrite(modOps);
  await bumpNs("courses"); // invalidate cached catalog list & discovery carousels

  console.log(`\n✅ Updated ${courseOps.length} course(s) and ${modOps.length} module(s). Cache invalidated.`);
  await mongoose.disconnect();
  process.exit(0);
}

run().catch(async (e) => {
  console.error("Cleanup failed:", e);
  try { await mongoose.disconnect(); } catch { /* ignore */ }
  process.exit(1);
});
