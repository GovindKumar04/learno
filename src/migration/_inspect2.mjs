import "dotenv/config";
import mongoose from "mongoose";
import connectMongoDB from "../config/mongodb.js";
await connectMongoDB();
const db = mongoose.connection;
const c = await db.collection("courses").findOne({ slug: "digital-marketing-mastery" });
// trim modules/reviews for brevity
c.modules = (c.modules||[]).length + " module refs";
c.reviews = (c.reviews||[]).length + " reviews";
console.log(JSON.stringify(c, null, 2));
await db.close(); process.exit(0);
