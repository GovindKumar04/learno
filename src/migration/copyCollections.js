// Generic one-time copy of specific collections from the CURRENT database
// (MONGODB_URI) into the NEW database (MONGODB_URL, falling back to MONGO_URL).
//
//   cd backend && node src/migration/copyCollections.js blogs
//   node src/migration/copyCollections.js blogs siteconfigs testimonials
//
// Documents are upserted by _id (preserving _id keeps every reference valid), so
// re-running reconciles instead of duplicating. The SOURCE database is only read.

import "dotenv/config";
import dns from "node:dns";
import mongoose from "mongoose";

// `mongodb+srv://` needs SRV/TXT DNS lookups — force public resolvers.
dns.setServers(["1.1.1.1", "8.8.8.8"]);

const SOURCE_URI = process.env.MONGODB_URI;
const TARGET_URI = process.env.MONGODB_URL || process.env.MONGO_URL;
const COLLECTIONS = process.argv.slice(2).filter(Boolean);

const BATCH_SIZE = 500;

const connect = (uri, label) =>
  mongoose
    .createConnection(uri, { serverSelectionTimeoutMS: 15000 })
    .asPromise()
    .then((conn) => {
      console.log(`✅ ${label} connected: ${conn.host}/${conn.name}`);
      return conn;
    });

const copyCollection = async (src, dst, name) => {
  const docs = await src.collection(name).find({}).toArray();
  if (docs.length === 0) {
    console.log(`• ${name}: 0 docs in source — skipping.`);
    return { collection: name, source: 0, new: 0, updated: 0 };
  }

  let upserted = 0;
  let modified = 0;
  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const ops = docs.slice(i, i + BATCH_SIZE).map((doc) => ({
      replaceOne: { filter: { _id: doc._id }, replacement: doc, upsert: true },
    }));
    const res = await dst.collection(name).bulkWrite(ops, { ordered: false });
    upserted += res.upsertedCount || 0;
    modified += res.modifiedCount || 0;
  }

  console.log(`• ${name}: ${docs.length} read → ${upserted} new, ${modified} updated.`);
  return { collection: name, source: docs.length, new: upserted, updated: modified };
};

const run = async () => {
  if (!SOURCE_URI) { console.error("❌ MONGODB_URI (source) is not set in .env"); process.exit(1); }
  if (!TARGET_URI) { console.error("❌ MONGODB_URL (target) is not set in .env"); process.exit(1); }
  if (SOURCE_URI === TARGET_URI) { console.error("❌ Source and target point to the same database."); process.exit(1); }
  if (COLLECTIONS.length === 0) {
    console.error("❌ No collections given. Usage: node src/migration/copyCollections.js <collection> [more...]");
    process.exit(1);
  }

  console.log(`⏳ Copying [${COLLECTIONS.join(", ")}] from source → target...`);
  const [src, dst] = await Promise.all([
    connect(SOURCE_URI, "source"),
    connect(TARGET_URI, "target"),
  ]);
  console.log("✅ Connected. Source is read-only.\n");

  const results = [];
  try {
    for (const name of COLLECTIONS) results.push(await copyCollection(src, dst, name));
  } finally {
    await src.close();
    await dst.close();
  }

  console.log("\n✅ Copy complete.");
  console.table(results);
  process.exit(0);
};

run().catch(async (err) => {
  console.error("\n❌ Copy failed:", err);
  try { await mongoose.disconnect(); } catch { /* ignore */ }
  process.exit(1);
});
