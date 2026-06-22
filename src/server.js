import "dotenv/config";

import { app } from "./app.js";
import connectMongoDB from "./config/mongodb.js";

const PORT = process.env.PORT || 3000;

// The app runs entirely on MongoDB.

async function startServer() {
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
