// Seeds (or updates) a single admin account in MongoDB. Idempotent: matched by
// email, so re-running updates the existing admin instead of creating a duplicate.
//
//   cd backend && npm run seed:admin
//
// Configure via .env (sensible fallbacks shown):
//   ADMIN_EMAIL     (default admin@fillipskillacademy.com)
//   ADMIN_PASSWORD  (default Admin@1234 — change it!)
//   ADMIN_NAME      (default Fillip Admin)
//   ADMIN_PHONE     (optional)
//
// Runs against whichever database MONGODB_URI points to in .env.

import "dotenv/config";
import mongoose from "mongoose";
import bcrypt from "bcrypt";
import connectMongoDB from "../config/mongodb.js";
import { User } from "../models/user.model.js";
import { newId } from "../utils/id.util.js";

const EMAIL    = process.env.ADMIN_EMAIL    || "vikashfillip@gmail.com";
const PASSWORD = process.env.ADMIN_PASSWORD || "Vikash@123$";
const NAME     = process.env.ADMIN_NAME     || "Fillip Academy Admin";
const PHONE    = process.env.ADMIN_PHONE    || "";

const run = async () => {
  await connectMongoDB();
  console.log(`⏳ Seeding admin on database "${mongoose.connection.name}"`);

  // Password is hashed the same way the auth service does (bcrypt, 10 rounds),
  // so the seeded admin can log in normally at /auth.
  const hashedPassword = await bcrypt.hash(PASSWORD, 10);

  // A legacy user with this email whose _id isn't a String would break .save()
  // at login (the schema declares a String _id). Drop it so the upsert below
  // re-inserts a clean String-_id admin.
  const raw = await User.collection.findOne({ email: EMAIL }, { projection: { _id: 1 } });
  if (raw && typeof raw._id !== "string") {
    await User.collection.deleteOne({ _id: raw._id });
    console.log("   (removed a legacy admin doc with a non-String _id)");
  }

  // Upsert by email atomically. Using updateOne (instead of loading the doc and
  // calling .save()) keeps this working even if an existing user with this email
  // has a non-String _id — and $setOnInsert gives brand-new admins a String _id.
  const res = await User.updateOne(
    { email: EMAIL },
    {
      $set: {
        full_name:   NAME,
        password:    hashedPassword,
        role:        "admin",
        is_verified: true,
        is_active:   true,
        ...(PHONE && { phone: PHONE }),
      },
      $setOnInsert: { _id: newId() },
    },
    { upsert: true },
  );
  console.log(`✅ ${res.upsertedCount ? "Created" : "Updated"} admin: ${EMAIL}`);

  console.log(`   Email:    ${EMAIL}`);
  console.log(`   Password: ${PASSWORD}`);
  console.log("   Log in at /auth, then open /admin.");

  await mongoose.connection.close();
  process.exit(0);
};

run().catch(async (err) => {
  console.error("❌ Admin seed failed:", err);
  try { await mongoose.connection.close(); } catch { /* ignore */ }
  process.exit(1);
});
