/**
 * Seed the 34 six-month professional programs and their module breakdown from
 * the FSA curriculum document.
 *
 * Source: src/scripts/data/sixMonthModules.txt (text extracted from
 *         "6_Month_Program_Detailed_Modules.docx"; the ❆ sub-topic glyph is
 *         normalised to ✦ to match the sibling data files).
 *
 * - Each program → one Course document + six Module documents (Month 1–6).
 * - Per the requirement, modules are NOT labelled by month: each module's title
 *   is just its topic (the "Month N —" prefix is dropped) and the duration reads
 *   "6 Months". The original sequence is preserved via each module's `order`.
 * - Idempotent: re-running upserts by slug and rebuilds that course's modules.
 * - Classroom-only delivery. Created as DRAFTS (isPublished:false) unless
 *   SEED_PUBLISH=true.
 *
 * Run from the backend folder:  node src/scripts/seedSixMonthCourses.js
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
const DATA_FILE = path.join(__dirname, "data", "sixMonthModules.txt");
const PUBLISH = process.env.SEED_PUBLISH === "true";
const DURATION = "6 Months";

const toSlug = (str) =>
  str.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const parseFee = (s = "") => Number(String(s).replace(/[^\d]/g, "")) || 0;

// ── Parse the curriculum text into structured programs ────────────────────────
function parseCourses(text) {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  // A program header looks like "Course #2: Generative AI & LLM Developer".
  const isHeader = (l) => /^Course #\d+:\s*\S/.test(l.trim());
  // Labels sit on their own line with the value on the next non-empty line.
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

    const name = block[0].trim().replace(/^Course #\d+:\s*/, "").trim();
    const domain = labelValue(block, "Domain");
    const fee = parseFee(labelValue(block, "Fees"));

    // Months → modules. A "Month N — Title" line opens a module, but we keep only
    // the topic as the title (no month wording). ✦ lines are sub-topics, › lines
    // are that sub-topic's bullets.
    const modules = [];
    let cur = null;
    let sub = null;
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
      const line = raw.trim();
      const mo = line.match(/^Month\s+(\d+)\s*[—–-]\s*(.+)$/);
      if (mo) {
        flushModule();
        cur = { order: Number(mo[1]), title: mo[2].trim(), focus: mo[2].trim(), topics: [], headings: [] };
        continue;
      }
      if (!cur) continue;
      if (line.includes("✦")) {
        flushSub();
        sub = { heading: line.replace(/^.*?✦\s*/, "").trim(), bullets: [] };
      } else if (/^›/.test(line)) {
        if (sub) sub.bullets.push(line.replace(/^›\s*/, "").trim());
      }
    }
    flushModule();

    courses.push({ name, category: domain || "Professional Courses", fee, modules });
  }
  return courses;
}

async function run() {
  if (!fs.existsSync(DATA_FILE)) {
    console.error(`❌ Data file not found: ${DATA_FILE}`);
    process.exit(1);
  }
  const courses = parseCourses(fs.readFileSync(DATA_FILE, "utf8"));
  console.log(`Parsed ${courses.length} programs from the curriculum.`);

  if (process.env.SEED_DRY === "true") {
    for (const c of courses) {
      console.log(`\n• ${c.name}  [${c.category}]  ₹${c.fee}  — ${DURATION}`);
      for (const m of c.modules) console.log(`    ${m.order}. ${m.title}  (${m.topics.length} topics)`);
    }
    console.log("\n(dry run — no database changes)");
    return;
  }

  await connectMongoDB();

  const admin = await User.findOne({ role: "admin" }).select("_id").lean();
  if (!admin) {
    console.error("❌ No admin user found to own the courses (createdBy).");
    await mongoose.disconnect();
    process.exit(1);
  }
  const createdBy = String(admin._id);

  let created = 0, updated = 0;
  for (const c of courses) {
    let slug = toSlug(c.name);
    const moduleTitles = c.modules.map((m) => m.focus);
    const learnPoints = c.modules.flatMap((m) => m.headings);
    const description =
      `${c.name} is an intensive 6-month professional program in ${c.category}. ` +
      `You'll progress through ${moduleTitles.slice(0, 3).join(", ")} and beyond, ` +
      `finishing with a capstone project, a job-ready portfolio and placement preparation.`;

    // Guard against clobbering a different-tier course that happens to share a slug.
    let course = await Course.findOne({ slug }).setOptions({ withDeleted: true });
    if (course && course.duration && course.duration !== DURATION) {
      slug = `${slug}-6-month`;
      course = await Course.findOne({ slug }).setOptions({ withDeleted: true });
    }
    const isNew = !course;
    if (!course) course = new Course({ slug, createdBy });

    course.set({
      title: c.name,
      description,
      category: c.category,
      level: "beginner",
      duration: DURATION,
      price: c.fee,
      priceOnline: c.fee,
      priceOffline: c.fee,
      priceLive: 0,
      modes: ["classroom"],
      learnPoints,
      isPublished: PUBLISH,
      deletedAt: null,
      createdBy: course.createdBy || createdBy,
    });
    await course.save();

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
    console.log(`  ${isNew ? "＋ created" : "↻ updated"}: ${c.name}  (${c.modules.length} modules, ₹${c.fee})`);
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
