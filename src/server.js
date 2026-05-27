import "dotenv/config";

import { app } from "./app.js";
import pool from "./config/db.js";
import connectMongoDB from "./config/mongodb.js";

const PORT = process.env.PORT || 3000;

async function startServer() {
  try {
    console.log("Connecting to databases...");

    
    await pool.query("SELECT 1");
    console.log("✅ PostgreSQL connected");

   
    await connectMongoDB();
    console.log("✅ MongoDB connected");

    
    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
    });

  } catch (error) {
    console.error("❌ Database connection failed:");
    console.error(error.message || error);

    process.exit(1); // IMPORTANT in production
  }
}

startServer();