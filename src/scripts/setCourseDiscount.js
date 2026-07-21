/**
 * Set a flat discount percentage on every (non-binned) course.
 *
 * Usage (from the backend folder):
 *   node src/scripts/setCourseDiscount.js          # 60% on all courses
 *   DISCOUNT=40 node src/scripts/setCourseDiscount.js
 *
 * The discount is applied server-side at checkout (see payment.service.js); the
 * stored prices stay as the strike-through originals.
 */
import "dotenv/config";
import mongoose from "mongoose";
import connectMongoDB from "../config/mongodb.js";
import { Course } from "../models/course.model.js";
import { bumpNs } from "../utils/cache.js";

const PERCENT = Math.min(Math.max(Number(process.env.DISCOUNT) || 60, 0), 90);

async function run() {
  await connectMongoDB();
  const res = await Course.updateMany({ deletedAt: null }, { $set: { discountPercent: PERCENT } });
  await bumpNs("courses"); // invalidate the public catalog cache
  console.log(`✅ Set ${PERCENT}% discount on ${res.modifiedCount} course(s) (matched ${res.matchedCount}).`);
  await mongoose.disconnect();
  process.exit(0);
}

run().catch(async (e) => {
  console.error("Failed:", e);
  try { await mongoose.disconnect(); } catch { /* ignore */ }
  process.exit(1);
});
