/**
 * Seed the Entrepreneur program courses (and their unit-by-unit modules) from the
 * FSA "Entrepreneur" curriculum documents.
 *
 * Sources (text extracted from the matching .docx in "d:\Fsa module"):
 *   data/entrepreneur1WeekModules.txt   —  9 courses × 6 Days
 *   data/entrepreneur1MonthModules.txt  — 24 courses × 4 Weeks
 *   data/entrepreneur3MonthModules.txt  — 15 courses × 3 Months
 *   data/entrepreneur6MonthModules.txt  —  2 courses × 6 Months
 *   (50 courses total, codes E1–E50.)
 *
 * Each source block looks like:
 *   Course #E1: <name>
 *   Domain
 *   <domain>            → becomes the course category
 *   Duration
 *   <duration>
 *   Fees
 *   Rs.12,999
 *
 *   Week 1 - <title>    ("Week" | "Day" | "Month" depending on the program)
 *   > <subtopic heading>
 *     <bullet>
 *     <bullet>
 *   > <subtopic heading>
 *     ...
 *
 * - Each course → one Course document + one Module per unit (Week/Day/Month).
 * - Idempotent: re-running upserts by slug and rebuilds that course's modules.
 * - The two "Franchise Business Development" courses (E35 1-Month, E36 3-Month)
 *   share a name, so any name that occurs in more than one program is
 *   disambiguated by appending the program's duration token to its slug.
 * - Courses are created as DRAFTS (isPublished:false). Set SEED_PUBLISH=true to
 *   publish on seed. SEED_DRY=true prints a summary without touching the DB.
 *
 * Run from the backend folder:  node src/scripts/seedEntrepreneurCourses.js
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import mongoose from "mongoose";
import connectMongoDB from "../config/mongodb.js";
import { Course } from "../models/course.model.js";
import { Module } from "../models/module.model.js";
import { User } from "../models/user.model.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLISH = process.env.SEED_PUBLISH === "true";

// Each program: its data file, the unit word used in module headings, and the
// slug token used to disambiguate courses whose name appears in >1 program.
const PROGRAMS = [
  { file: "entrepreneur1WeekModules.txt",  unit: "Day",   durationToken: "1-week" },
  { file: "entrepreneur1MonthModules.txt", unit: "Week",  durationToken: "1-month" },
  { file: "entrepreneur3MonthModules.txt", unit: "Month", durationToken: "3-month" },
  { file: "entrepreneur6MonthModules.txt", unit: "Month", durationToken: "6-month" },
];

const toSlug = (str) =>
  str.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const parseFee = (s = "") => Number(String(s).replace(/[^\d]/g, "")) || 0;

// ── Parse one program's curriculum text into structured courses ───────────────
function parseCourses(text) {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);

  // A course opens at "Course #E<n>: <name>".
  const isHeader = (l) => /^Course\s+#\S+:\s*\S/.test(l.trim());
  // A module opens at "Week|Day|Month <n> - <title>".
  const unitRe = /^(Week|Day|Month)\s+(\d+)\s*[-–—]\s*(.+)$/;

  // Label/value: the value is the next non-empty line after a bare label line.
  const labelValue = (block, label) => {
    for (let i = 0; i < block.length; i++) {
      if (block[i].trim() === label) {
        for (let j = i + 1; j < block.length; j++) if (block[j].trim()) return block[j].trim();
      }
    }
    return "";
  };

  const headerIdx = [];
  for (let i = 0; i < lines.length; i++) if (isHeader(lines[i])) headerIdx.push(i);

  const courses = [];
  for (let h = 0; h < headerIdx.length; h++) {
    const start = headerIdx[h];
    const end = h + 1 < headerIdx.length ? headerIdx[h + 1] : lines.length;
    const block = lines.slice(start, end);

    const headerLine = block[0].trim();
    const code = (headerLine.match(/^Course\s+#(\S+):/) || [])[1] || "";
    const name = headerLine.replace(/^Course\s+#\S+:\s*/, "").trim();
    const domain = labelValue(block, "Domain");
    const duration = labelValue(block, "Duration");
    const fee = parseFee(labelValue(block, "Fees"));

    // Units → modules. A unit line opens a module; "> " lines are its subtopics,
    // and the 2-space-indented lines under a subtopic are that subtopic's bullets.
    const modules = [];
    let cur = null;   // current module
    let sub = null;   // current subtopic { heading, bullets:[] }
    const flushSub = () => {
      if (cur && sub) {
        const topic = sub.bullets.length ? `${sub.heading} — ${sub.bullets.join("; ")}` : sub.heading;
        cur.topics.push(topic);
        cur.headings.push(sub.heading);
      }
      sub = null;
    };
    const flushModule = () => { flushSub(); if (cur) modules.push(cur); cur = null; };

    for (const raw of block) {
      const um = raw.trim().match(unitRe);
      if (um) {
        flushModule();
        const label = `${um[1]} ${um[2]}`;
        cur = { order: Number(um[2]), title: `${label} — ${um[3].trim()}`, focus: um[3].trim(), topics: [], headings: [] };
        continue;
      }
      if (!cur) continue;
      if (/^>\s+/.test(raw)) {            // subtopic heading (no leading indent)
        flushSub();
        sub = { heading: raw.replace(/^>\s+/, "").trim(), bullets: [] };
      } else if (/^\s{2,}\S/.test(raw)) { // indented bullet under the subtopic
        if (sub) sub.bullets.push(raw.trim());
      }
    }
    flushModule();

    courses.push({ code, name, domain, duration, fee, modules });
  }
  return courses;
}

async function run() {
  // Parse every program up front so we can detect cross-program name collisions.
  const all = [];
  for (const prog of PROGRAMS) {
    const file = path.join(__dirname, "data", prog.file);
    if (!fs.existsSync(file)) {
      console.error(`❌ Data file not found: ${file}`);
      process.exit(1);
    }
    const parsed = parseCourses(fs.readFileSync(file, "utf8"));
    console.log(`Parsed ${parsed.length} courses from ${prog.file}`);
    for (const c of parsed) all.push({ ...c, prog });
  }

  // Names that appear in more than one program get the duration token appended
  // to their slug so they don't upsert over each other.
  const nameCount = all.reduce((m, c) => m.set(c.name, (m.get(c.name) || 0) + 1), new Map());
  for (const c of all) {
    const base = toSlug(c.name);
    c.slug = nameCount.get(c.name) > 1 ? `${base}-${c.prog.durationToken}` : base;
  }

  console.log(`\nTotal: ${all.length} entrepreneur courses.`);

  // Dry run: print a summary and exit without touching the database.
  if (process.env.SEED_DRY === "true") {
    for (const c of all) {
      console.log(`\n• [${c.code}] ${c.name}  (${c.slug})  [${c.domain}]  ₹${c.fee}  — ${c.duration}`);
      for (const m of c.modules) console.log(`    ${m.title}  (${m.topics.length} topics)`);
    }
    console.log("\n(dry run — no database changes)");
    return;
  }

  await connectMongoDB();

  const admin = await User.findOne({ role: "admin" }).select("_id").lean();
  if (!admin) {
    console.error("❌ No admin user found to own the courses (createdBy). Create an admin first.");
    await mongoose.disconnect();
    process.exit(1);
  }
  const createdBy = String(admin._id);

  let created = 0, updated = 0;
  for (const c of all) {
    const unitTitles = c.modules.map((m) => m.focus);
    const learnPoints = c.modules.flatMap((m) => m.headings);
    const description =
      `${c.name} is a hands-on ${c.duration} entrepreneur program. ` +
      `You'll work through ${unitTitles.slice(0, 3).join(", ")}` +
      `${unitTitles.length > 3 ? ", and more" : ""}, finishing with a capstone project. ` +
      `Part of the Fillip Skill Academy ${c.domain} track for founders and business owners.`;

    // Upsert the course (include soft-deleted so a binned same-slug course is reused, not duplicated).
    let course = await Course.findOne({ slug: c.slug }).setOptions({ withDeleted: true });
    const isNew = !course;
    if (!course) course = new Course({ slug: c.slug, createdBy });

    course.set({
      title: c.name,
      description,
      category: c.domain || "Entrepreneurship",
      level: "beginner",
      duration: c.duration,
      price: c.fee,
      priceOnline: c.fee,
      priceOffline: c.fee,
      priceLive: 0,
      modes: ["classroom"],
      learnPoints,
      isPublished: PUBLISH,
      deletedAt: null, // ensure a reused binned course comes back live
      createdBy: course.createdBy || createdBy,
    });
    await course.save();

    // Rebuild this course's modules from the unit breakdown.
    await Module.deleteMany({ course: course._id });
    const mods = await Module.insertMany(
      c.modules.map((m) => ({
        title: m.title,
        description: m.focus,
        course: course._id,
        order: m.order,
        topics: m.topics,
      })),
    );
    course.modules = mods.map((m) => m._id);
    await course.save();

    if (isNew) created++; else updated++;
    console.log(`  ${isNew ? "＋ created" : "↻ updated"}: [${c.code}] ${c.name}  (${c.modules.length} modules, ₹${c.fee})`);
  }

  console.log(`\n✅ Done. ${created} created, ${updated} updated. Published: ${PUBLISH ? "YES" : "NO (drafts)"}`);
  await mongoose.disconnect();
  process.exit(0);
}

run().catch(async (e) => {
  console.error("Seed failed:", e);
  try { await mongoose.disconnect(); } catch { /* ignore */ }
  process.exit(1);
});
