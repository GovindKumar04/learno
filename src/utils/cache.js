import redis from "../config/redis.js";

// Thin, failure-tolerant cache layer. Every call is wrapped so a Redis hiccup
// can never break a request — on any error we just behave as a cache miss.
const ready = () => redis && redis.status === "ready";

// Read-through: return the cached value for `key`, else run `producer`, cache
// its result for `ttlSeconds`, and return it. Values are JSON-serialized, so
// callers get plain objects back on a hit (fine — controllers only res.json them).
export const getOrSet = async (key, ttlSeconds, producer) => {
  if (ready()) {
    try {
      const hit = await redis.get(key);
      if (hit !== null) return JSON.parse(hit);
    } catch { /* treat as miss */ }
  }

  const value = await producer();

  if (ready() && value !== undefined && value !== null) {
    try { await redis.set(key, JSON.stringify(value), "EX", ttlSeconds); } catch { /* ignore */ }
  }
  return value;
};

// Delete specific keys (used for single-doc caches like site-config).
export const cacheDel = async (...keys) => {
  if (!ready() || keys.length === 0) return;
  try { await redis.del(...keys); } catch { /* ignore */ }
};

// Namespace versioning. Rather than tracking and deleting every key variant
// (e.g. one per catalog filter/page combo), we bake a generation number into
// each key. Bumping the namespace abandons all old keys at once; they fall out
// by TTL. Avoids KEYS/SCAN entirely.
export const nsKey = async (ns, suffix) => {
  let gen = 0;
  if (ready()) {
    try { gen = (await redis.get(`ns:${ns}`)) || 0; } catch { gen = 0; }
  }
  return `${ns}:v${gen}:${suffix}`;
};

export const bumpNs = async (ns) => {
  if (!ready()) return;
  try { await redis.incr(`ns:${ns}`); } catch { /* ignore */ }
};
