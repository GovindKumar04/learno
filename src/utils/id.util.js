import crypto from "node:crypto";

// RFC 9562 UUIDv7 — a time-ordered UUID: 48-bit Unix-ms timestamp + 74 random
// bits, with the version (7) and variant bits set. Non-enumerable like v4, but
// monotonic so it keeps B-tree index locality (good insert/scan performance).
// Dependency-free; generated app-side.
export function uuidv7() {
  const ts = Date.now();
  const b = crypto.randomBytes(16);

  // 48-bit big-endian timestamp in bytes 0..5
  b[0] = Math.floor(ts / 2 ** 40) & 0xff;
  b[1] = Math.floor(ts / 2 ** 32) & 0xff;
  b[2] = Math.floor(ts / 2 ** 24) & 0xff;
  b[3] = Math.floor(ts / 2 ** 16) & 0xff;
  b[4] = Math.floor(ts / 2 ** 8) & 0xff;
  b[5] = ts & 0xff;

  b[6] = (b[6] & 0x0f) | 0x70; // version 7
  b[8] = (b[8] & 0x3f) | 0x80; // variant 10

  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// Convenience alias used when creating new documents.
export const newId = uuidv7;

// True if a value is a valid UUID string. Used to skip legacy (pre-migration
// non-UUID) references when querying the users collection, so a stray old id
// can't break a user lookup.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v) => typeof v === "string" && UUID_RE.test(v);
