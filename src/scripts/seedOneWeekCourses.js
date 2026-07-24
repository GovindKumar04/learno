/**
 * Seed the 15 one-week (6-day) professional certification courses and their
 * day-by-day modules from the FSA curriculum document.
 *
 * Source: src/scripts/data/oneWeekModules.txt (text extracted from
 *         "1_Week_6Day_Modules_Detailed.docx").
 *
 * - Each course → one Course document + six Module documents (Day 1–6).
 * - Idempotent: re-running upserts by slug and rebuilds that course's modules.
 * - Classroom-only delivery. Created as DRAFTS (isPublished:false) unless
 *   SEED_PUBLISH=true.
 *
 * Run from the backend folder:  node src/scripts/seedOneWeekCourses.js
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
const DATA_FILE = path.join(__dirname, "data", "oneWeekModules.txt");
const PUBLISH = process.env.SEED_PUBLISH === "true";
const DURATION = "1 Week";

const toSlug = (str) =>
  str.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const parseFee = (s = "") => Number(String(s).replace(/[^\d]/g, "")) || 0;
const splitList = (s = "") => s.split(/[,&]/).map((x) => x.trim()).filter(Boolean);

// Domain/category per course (the source doc has no category column).
const categoryFor = (name) => {
  const n = name.toLowerCase();
  if (n.includes("computer foundation") || n.includes("microsoft office") || n.includes("ms office")) return "Office Productivity";
  if (n.includes("excel") || n.includes("power bi") || n.includes("data analysis") || n.includes("analytics") || n.includes("business intelligence")) return "Data & Analytics";
  if (n.includes("python")) return "Programming";
  if (n.includes("website") || n.includes("wordpress") || n.includes("web ")) return "Web Development";
  if (n.includes("video")) return "Video Editing";
  if (n.includes("graphic")) return "Graphic Design";
  if (n.includes("digital marketing")) return "Digital Marketing";
  if (n.includes("cyber")) return "Cyber Security";
  if (n.includes("hardware") || n.includes("networking")) return "Hardware & Networking";
  if (n.includes("tally") || n.includes("gst") || n.includes("account")) return "Accounting & Finance";
  if (n.includes("ai ") || n.includes("artificial intelligence")) return "Artificial Intelligence";
  if (n.includes("employability") || n.includes("career")) return "Career Development";
  return "Professional Courses";
};

// ── Parse the curriculum text into structured courses ────────────────────────
function parseCourses(text) {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  const isHeader = (l) => /^\d{1,2}\.\s+\S/.test(l.trim());
  const labelValue = (block, label) => {
    for (let i = 0; i < block.length; i++) {
      if (block[i].trim() === label) {
        for (let j = i + 1; j < block.length; j++) if (block[j].trim()) return block[j].trim();
      }
    }
    return "";
  };

  const headerIdx = [];
  for (let i = 0; i < lines.length; i++) {
    if (!isHeader(lines[i])) continue;
    const near = lines.slice(i, i + 12).some((l) => l.trim() === "Duration");
    if (near) headerIdx.push(i);
  }

  const courses = [];
  for (let h = 0; h < headerIdx.length; h++) {
    const start = headerIdx[h];
    const end = h + 1 < headerIdx.length ? headerIdx[h + 1] : lines.length;
    const block = lines.slice(start, end);

    const name = block[0].trim().replace(/^\d{1,2}\.\s+/, "").trim();
    const fee = parseFee(labelValue(block, "Fees (Bihar)"));
    const eligibility = labelValue(block, "Eligibility");
    const career = labelValue(block, "Career Opportunities");

    // Days → modules. A "Day N — Title" line opens a module; ✦ lines are
    // sub-topics, › lines are that sub-topic's bullets.
    const modules = [];
    let cur = null, sub = null;
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
      const day = line.match(/^Day\s+(\d+)\s*[—–-]\s*(.+)$/);
      if (day) {
        flushModule();
        cur = { order: Number(day[1]), title: day[2].trim(), focus: day[2].trim(), topics: [], headings: [] };
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

    courses.push({ name, fee, eligibility, career, modules });
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

  if (process.env.SEED_DRY === "true") {
    for (const c of courses) {
      console.log(`\n• ${c.name}  [${categoryFor(c.name)}]  ₹${c.fee}`);
      console.log(`  eligibility: ${c.eligibility} | career: ${c.career}`);
      for (const m of c.modules) console.log(`    ${m.title}  (${m.topics.length} topics)`);
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
    const dayTitles = c.modules.map((m) => m.focus);
    const learnPoints = c.modules.flatMap((m) => m.headings);
    const description =
      `${c.name} is a hands-on 1-week professional certification. ` +
      `You'll cover ${dayTitles.slice(0, 3).join(", ")}, then complete a mini project, ` +
      `assessment and career guidance. Ideal for ${(c.eligibility || "learners").toLowerCase()} ` +
      `aiming for roles such as ${c.career || "industry professionals"}.`;

    let course = await Course.findOne({ slug }).setOptions({ withDeleted: true });
    // If this slug already belongs to another tier's course (different duration),
    // namespace this one with a "-1-week" suffix so we never clobber it.
    if (course && course.duration && course.duration !== DURATION) {
      slug = `${slug}-1-week`;
      course = await Course.findOne({ slug }).setOptions({ withDeleted: true });
    }
    const isNew = !course;
    if (!course) course = new Course({ slug, createdBy });

    course.set({
      title: c.name,
      description,
      category: categoryFor(c.name),
      level: "beginner",
      duration: DURATION,
      price: c.fee,
      priceOnline: c.fee,
      priceOffline: c.fee,
      priceLive: 0,
      modes: ["classroom"],
      targetAudience: splitList(c.eligibility),
      benefits: splitList(c.career),
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
    console.log(`  ${isNew ? "＋ created" : "↻ updated"}: ${c.name}  (${c.modules.length} days, ₹${c.fee})`);
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
