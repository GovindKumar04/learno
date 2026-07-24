// One-off cleanup: permanently remove all internship-related data from the DB.
//   • Enquiry docs with category "internship" (internship applications)
//   • Certificate docs with type "internship" (issued internship certificates)
//
// Usage (from backend/):  node src/scripts/deleteInternshipData.js
// Add --dry to only COUNT what would be deleted without deleting anything.

import "dotenv/config";
import mongoose from "mongoose";
import connectMongoDB from "../config/mongodb.js";
import { Enquiry } from "../models/enquiry.model.js";
import { Certificate } from "../models/certificate.model.js";

const DRY = process.argv.includes("--dry");

async function run() {
  await connectMongoDB();

  const enquiryFilter = { category: "internship" };
  const certFilter = { type: "internship" };

  const [enquiryCount, certCount] = await Promise.all([
    Enquiry.countDocuments(enquiryFilter),
    Certificate.countDocuments(certFilter),
  ]);

  console.log(`Found ${enquiryCount} internship enquiries and ${certCount} internship certificates.`);

  if (DRY) {
    console.log("--dry set — nothing deleted.");
  } else {
    const [enqRes, certRes] = await Promise.all([
      Enquiry.deleteMany(enquiryFilter),
      Certificate.deleteMany(certFilter),
    ]);
    console.log(`Deleted ${enqRes.deletedCount} enquiries and ${certRes.deletedCount} certificates.`);
  }

  await mongoose.connection.close();
  process.exit(0);
}

run().catch(async (err) => {
  console.error("Cleanup failed:", err.message);
  try { await mongoose.connection.close(); } catch { /* ignore */ }
  process.exit(1);
});
