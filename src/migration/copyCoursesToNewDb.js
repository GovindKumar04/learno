// One-time data copy: clone the course-content tree (courses + modules + materials)
// from the CURRENT database (MONGODB_URI) into a NEW database (MONGO_URL).
//
//   cd backend && node src/migration/copyCoursesToNewDb.js
//   # or: npm run migrate:courses
//
// Why these three: a Course references its Modules, a Module references its
// Materials, all by real ObjectId. Course reviews are embedded inside the course
// document, so they come along automatically. Media (thumbnails, material files)
// are Cloudinary URL strings shared by both DBs — copying the documents is enough,
// nothing is re-uploaded.
//
// Safe to re-run: every document is upserted by its _id (preserving _id keeps all
// cross-references valid), so a second run reconciles instead of duplicating.
// The SOURCE database is only ever read — nothing there is modified or dropped.
//
// Requires BOTH connection strings in .env:
//   MONGODB_URI  → source (the database the app currently uses)
//   MONGO_URL    → target (the new database to populate)

import "dotenv/config";
import dns from "node:dns";
import mongoose from "mongoose";

// `mongodb+srv://` needs SRV/TXT DNS lookups. Some networks hand Node a resolver
// that refuses SRV queries even though GUI tools work — force public resolvers.
dns.setServers(["1.1.1.1", "8.8.8.8"]);

const SOURCE_URI = process.env.MONGODB_URI;
const TARGET_URI = process.env.MONGO_URL;

// Course-content tree only (mongoose default collection names).
const COLLECTIONS = ["courses", "modules", "materials"];

const BATCH_SIZE = 500;

const connect = (uri, label) =>
  mongoose
    .createConnection(uri, { serverSelectionTimeoutMS: 15000 })
    .asPromise()
    .then((conn) => {
      console.log(`✅ ${label} connected: ${conn.host}/${conn.name}`);
      return conn;
    });

// Copy one collection: read every doc from source, upsert-by-_id into target in
// batches. replaceOne(upsert) keeps the target a faithful mirror of the source doc.
const copyCollection = async (src, dst, name) => {
  const docs = await src.collection(name).find({}).toArray();
  if (docs.length === 0) {
    console.log(`• ${name}: 0 docs in source — skipping.`);
    return { collection: name, source: 0, new: 0, updated: 0 };
  }

  let upserted = 0;
  let modified = 0;
  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const batch = docs.slice(i, i + BATCH_SIZE);
    const ops = batch.map((doc) => ({
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
  if (!SOURCE_URI) {
    console.error("❌ MONGODB_URI (source) is not set in .env");
    process.exit(1);
  }
  if (!TARGET_URI) {
    console.error("❌ MONGO_URL (target / new database) is not set in .env");
    process.exit(1);
  }
  if (SOURCE_URI === TARGET_URI) {
    console.error("❌ MONGODB_URI and MONGO_URL point to the same database — nothing to copy.");
    process.exit(1);
  }

  console.log("⏳ Connecting to source (MONGODB_URI) and target (MONGO_URL)...");
  const [src, dst] = await Promise.all([
    connect(SOURCE_URI, "source"),
    connect(TARGET_URI, "target"),
  ]);
  console.log("✅ Connected. Source is read-only; nothing there is modified.\n");

  const results = [];
  try {
    for (const name of COLLECTIONS) {
      results.push(await copyCollection(src, dst, name));
    }
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
