/**
 * Seed the 15 one-month professional certification courses (and their week-by-week
 * modules) from the FSA curriculum document.
 *
 * Source: src/scripts/data/oneMonthModules.txt (text extracted from
 *         "1_Month_Course_Modules_Detailed.docx").
 *
 * - Each course → one Course document + four Module documents (Week 1–4).
 * - Idempotent: re-running upserts by slug and rebuilds that course's modules.
 * - Courses are created as DRAFTS (isPublished:false) so nothing goes live until
 *   you review them. Set SEED_PUBLISH=true to publish on seed.
 *
 * Run from the backend folder:  node src/scripts/seedOneMonthCourses.js
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
const DATA_FILE = path.join(__dirname, "data", "oneMonthModules.txt");
const PUBLISH = process.env.SEED_PUBLISH === "true";

const toSlug = (str) =>
  str.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const parseFee = (s = "") => Number(String(s).replace(/[^\d]/g, "")) || 0;

const splitList = (s = "") => s.split(/[,&]/).map((x) => x.trim()).filter(Boolean);

// Domain/category per course (the source doc has no category column).
const categoryFor = (name) => {
  const n = name.toLowerCase();
  if (n.includes("office executive")) return "Office Productivity";
  if (n.includes("accountant") || n.includes("tally")) return "Accounting & Finance";
  if (n.includes("web design") || n.includes("wordpress")) return "Web Development";
  if (n.includes("python")) return "Programming";
  if (n.includes("video")) return "Video Editing";
  if (n.includes("graphic")) return "Graphic Design";
  if (n.includes("digital marketing")) return "Digital Marketing";
  if (n.includes("hardware") || n.includes("networking")) return "Hardware & Networking";
  if (n.includes("cyber")) return "Cyber Security";
  if (n.includes("power bi") || n.includes("data analytics") || n.includes("analytics")) return "Data & Analytics";
  if (n.includes("mobile") || n.includes("flutter")) return "Mobile Development";
  if (n.includes("artificial intelligence") || n.includes(" ai ")) return "Artificial Intelligence";
  if (n.includes("ui/ux") || n.includes("ux")) return "UI/UX Design";
  return "Professional Courses";
};

// ── Parse the curriculum text into structured courses ────────────────────────
function parseCourses(text) {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  const isHeader = (l) => /^\d{1,2}\.\s+\S/.test(l.trim());
  const nextNonEmpty = (i) => {
    for (let j = i + 1; j < lines.length; j++) if (lines[j].trim()) return lines[j].trim();
    return "";
  };
  const labelValue = (block, label) => {
    for (let i = 0; i < block.length; i++) {
      if (block[i].trim() === label) {
        for (let j = i + 1; j < block.length; j++) if (block[j].trim()) return block[j].trim();
      }
    }
    return "";
  };

  // Collect the 15 course header line indexes (guarded by a nearby "Duration").
  const headerIdx = [];
  for (let i = 0; i < lines.length; i++) {
    if (!isHeader(lines[i])) continue;
    const near = lines.slice(i, i + 10).some((l) => l.trim() === "Duration");
    if (near) headerIdx.push(i);
  }

  const courses = [];
  for (let h = 0; h < headerIdx.length; h++) {
    const start = headerIdx[h];
    const end = h + 1 < headerIdx.length ? headerIdx[h + 1] : lines.length;
    const block = lines.slice(start, end);

    const name = block[0].trim().replace(/^\d{1,2}\.\s+/, "").trim();
    // Normalise the duration: drop any redundant "(4 Weeks)"-style parenthetical.
    const duration = (labelValue(block, "Duration") || "1 Month")
      .replace(/\s*\((?:[^)]*\b(?:week|day)s?\b[^)]*)\)/gi, "").trim();
    const fee = parseFee(labelValue(block, "Fees (Bihar)"));
    const eligibility = labelValue(block, "Eligibility");
    const career = labelValue(block, "Career Opportunities");

    // Weeks → modules. A "Week N — Title" line opens a module; ✦ lines are
    // sub-topics, › lines are that sub-topic's bullets.
    const modules = [];
    let cur = null;         // current module
    let sub = null;         // current ✦ subtopic { heading, bullets:[] }
    const flushSub = () => {
      if (cur && sub) {
        cur.topics.push(sub.heading, ...sub.bullets);
        cur.headings.push(sub.heading);
      }
      sub = null;
    };
    const flushModule = () => { flushSub(); if (cur) modules.push(cur); cur = null; };

    for (const raw of block) {
      const line = raw.trim();
      const wk = line.match(/^Week\s+(\d+)\s*[—–-]\s*(.+)$/);
      if (wk) {
        flushModule();
        cur = { order: Number(wk[1]), title: wk[2].trim(), focus: wk[2].trim(), topics: [], headings: [] };
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

    courses.push({ name, duration, fee, eligibility, career, modules });
  }
  return courses;
}

async function run() {
  if (!fs.existsSync(DATA_FILE)) {
    console.error(`❌ Data file not found: ${DATA_FILE}`);
    process.exit(1);
  }
  const courses = parseCourses(fs.readFileSync(DATA_FILE, "utf8"));
  console.log(`Parsed ${courses.length} courses from the curriculum.`);
  if (courses.length !== 15) {
    console.warn(`⚠️  Expected 15 courses but parsed ${courses.length}. Continuing anyway.`);
  }

  // Dry run: print a summary and exit without touching the database.
  if (process.env.SEED_DRY === "true") {
    for (const c of courses) {
      console.log(`\n• ${c.name}  [${categoryFor(c.name)}]  ₹${c.fee}  — ${c.duration}`);
      console.log(`  eligibility: ${c.eligibility} | career: ${c.career}`);
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
  for (const c of courses) {
    const slug = toSlug(c.name);
    const weekTitles = c.modules.map((m) => m.focus);
    const learnPoints = c.modules.flatMap((m) => m.headings);
    const description =
      `${c.name} is a hands-on 1-month professional certification. ` +
      `You'll cover ${weekTitles.slice(0, 3).join(", ")}, then complete a capstone project, ` +
      `assessment and career preparation. Ideal for ${(c.eligibility || "learners").toLowerCase()} ` +
      `aiming for roles such as ${c.career || "industry professionals"}.`;

    // Upsert the course (include soft-deleted so a binned same-slug course is reused, not duplicated).
    let course = await Course.findOne({ slug }).setOptions({ withDeleted: true });
    const isNew = !course;
    if (!course) course = new Course({ slug, createdBy });

    course.set({
      title: c.name,
      description,
      category: categoryFor(c.name),
      level: "beginner",
      duration: c.duration,
      price: c.fee,
      priceOnline: c.fee,
      priceOffline: c.fee,
      priceLive: 0,
      modes: ["classroom"],
      targetAudience: splitList(c.eligibility),
      benefits: splitList(c.career),
      learnPoints,
      isPublished: PUBLISH,
      deletedAt: null, // ensure a reused binned course comes back live
      createdBy: course.createdBy || createdBy,
    });
    await course.save();

    // Rebuild this course's modules from the weekly breakdown.
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
    console.log(`  ${isNew ? "＋ created" : "↻ updated"}: ${c.name}  (${c.modules.length} weeks, ₹${c.fee})`);
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
