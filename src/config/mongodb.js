import mongoose from "mongoose";
import dns from "node:dns";

// `mongodb+srv://` needs SRV/TXT DNS lookups. Some networks/ISPs hand Node a
// resolver that refuses SRV queries (error: querySrv ECONNREFUSED) even though
// GUI tools like Compass work. Force a public resolver that answers SRV.
dns.setServers(["1.1.1.1", "8.8.8.8"]);

const connectMongoDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 15000, // fail fast with a clear error
    });
    console.log(`MongoDB connected: ${conn.connection.host}`);
  } catch (error) {
    console.error("MongoDB connection error:", error.message);
    process.exit(1);
  }
};

export default connectMongoDB;