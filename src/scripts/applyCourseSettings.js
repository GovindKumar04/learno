/**
 * Bulk-apply catalog settings to every (non-binned) course, then reliably
 * invalidate the public catalog cache.
 *
 *   node src/scripts/applyCourseSettings.js
 *
 * Sets: classroom-only delivery + a 60% discount (override via env DISCOUNT).
 */
import "dotenv/config";
import mongoose from "mongoose";
import connectMongoDB from "../config/mongodb.js";
import { Course } from "../models/course.model.js";
import { bumpNs } from "../utils/cache.js";
import redis from "../config/redis.js";

const PERCENT = Math.min(Math.max(Number(process.env.DISCOUNT) || 60, 0), 90);

// Wait until Redis is actually "ready" — bumpNs no-ops before that.
function ensureRedisReady() {
  if (!redis) return Promise.resolve(false);
  if (redis.status === "ready") return Promise.resolve(true);
  return new Promise((res) => {
    const t = setTimeout(() => res(redis.status === "ready"), 4000);
    redis.once("ready", () => { clearTimeout(t); res(true); });
  });
}

async function run() {
  await connectMongoDB();

  const res = await Course.updateMany(
    { deletedAt: null },
    { $set: { modes: ["classroom"], discountPercent: PERCENT } },
  );

  const ready = await ensureRedisReady();
  if (ready) await bumpNs("courses");

  console.log(
    `✅ Updated ${res.modifiedCount}/${res.matchedCount} course(s): classroom-only, ${PERCENT}% discount.` +
    ` Cache ${ready ? "invalidated" : "NOT invalidated (Redis not ready — will expire by TTL)"}.`,
  );

  await mongoose.disconnect();
  if (redis) redis.disconnect();
  process.exit(0);
}

run().catch(async (e) => {
  console.error("Failed:", e);
  try { await mongoose.disconnect(); } catch { /* ignore */ }
  process.exit(1);
});
