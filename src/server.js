import "dotenv/config";

import { app } from "./app.js";
import pool from "./config/db.js";
import connectMongoDB from "./config/mongodb.js";

const PORT = process.env.PORT || 3000;



async function startServer() {
  // ── PostgreSQL ──────────────────────────────────────────────────────────────
  console.log("⏳ Connecting to PostgreSQL...");
  try {
    await pool.query("SELECT 1");
    console.log("✅ PostgreSQL connected");
  } catch (err) {
    console.error("❌ PostgreSQL connection failed:", err.message);
    console.error("   Check DATABASE_URL in .env — make sure the Neon DB is active (not suspended).");
    process.exit(1);
  }

  // ── MongoDB ─────────────────────────────────────────────────────────────────
  console.log("⏳ Connecting to MongoDB...");
  try {
    await connectMongoDB();
  } catch (err) {
    console.error("❌ MongoDB connection failed:", err.message);
    console.error("   Make sure the MongoDB service is running.");
    process.exit(1);
  }

  // ── Start HTTP server ────────────────────────────────────────────────────────
  app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
  });
}

startServer();
