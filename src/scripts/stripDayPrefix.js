/**
 * Remove the "Day N — " prefix from one-week course module titles.
 *   "Day 1 — Introduction to Computers" → "Introduction to Computers"
 * Only touches modules whose title starts with "Day <number>".
 *
 * Run from the backend folder:  node src/scripts/stripDayPrefix.js
 */
import "dotenv/config";
import mongoose from "mongoose";
import connectMongoDB from "../config/mongodb.js";
import { Module } from "../models/module.model.js";

const DAY_PREFIX = /^Day\s+\d+\s*[—–-]\s*/;

async function run() {
  await connectMongoDB();
  const mods = await Module.find({ title: /^Day\s+\d+/ }).select("title");
  let changed = 0;
  for (const m of mods) {
    const next = m.title.replace(DAY_PREFIX, "").trim();
    if (next && next !== m.title) {
      m.title = next;
      await m.save();
      changed++;
    }
  }
  console.log(`✅ Stripped "Day N —" prefix from ${changed} module(s).`);
  await mongoose.disconnect();
  process.exit(0);
}

run().catch(async (e) => {
  console.error("Failed:", e);
  try { await mongoose.disconnect(); } catch { /* ignore */ }
  process.exit(1);
});
