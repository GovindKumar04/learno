import Redis from "ioredis";

// Optional cache. If REDIS_URL is unset (e.g. local dev), or Redis is down, the
// app runs normally with caching simply disabled — every cache helper degrades
// to a pass-through (see utils/cache.js). Nothing here ever throws into a
// request. In production Redis runs on the same VPS (localhost) — no paid add-on.
let redis = null;

if (process.env.REDIS_URL) {
  redis = new Redis(process.env.REDIS_URL, {
    enableOfflineQueue: false, // fail commands fast when down instead of buffering
    maxRetriesPerRequest: 1,
    retryStrategy: (times) => Math.min(times * 500, 5000), // reconnect w/ backoff
  });

  redis.on("connect", () => console.log("✅ Redis connected"));

  // Throttle the error log so a prolonged outage doesn't spam the console on
  // every reconnect attempt; reset once we're healthy again.
  let warned = false;
  redis.on("error", (err) => {
    if (!warned) {
      console.warn("⚠️  Redis unavailable — running without cache:", err.message);
      warned = true;
    }
  });
  redis.on("ready", () => { warned = false; });
} else {
  console.log("ℹ️  REDIS_URL not set — caching disabled");
}

export default redis;
