// Restore the two internship certificate records that were deleted on 2026-07-23.
// Reconstructed from the surviving PDF files (backups/internship-certificates/).
// A re-download of these records reproduces the original PDFs exactly.
//
// Idempotent: skips any certificate whose certificateNo already exists.
//
// Usage (from backend/):  node src/scripts/restoreInternshipCertificates.js
// Add --dry to preview what would be inserted without writing anything.

import "dotenv/config";
import { randomUUID } from "crypto";
import mongoose from "mongoose";
import connectMongoDB from "../config/mongodb.js";
import { Certificate } from "../models/certificate.model.js";

const DRY = process.argv.includes("--dry");

// Shared internship details (both interns, HR Department, same duration/signatories).
const COMMON = {
  courseId: null,
  courseName: "HR", // template renders "as a HR Intern"
  isManual: true,
  type: "internship",
  fromDate: new Date("2026-06-09T00:00:00.000Z"),
  toDate: new Date("2026-07-24T00:00:00.000Z"),
  department: "HR", // template renders "in HR Department"
  signatoryName: "Khushi Bharti",
  signatoryDesignation: "HR Generalist",
  trainerName: "Lincy Bhardwaj",
  trainerDesignation: "Trainer (HR Executive)",
  issuedBy: "restore-script",
  issuedAt: new Date("2026-07-08T00:00:00.000Z"), // encoded in the certificate no.
};

const RECORDS = [
  { ...COMMON, certificateNo: "FTCTF-260708-AA00-5C3", studentName: "FARHA MALICK" },
  { ...COMMON, certificateNo: "FTCTF-260708-AA01-5C4", studentName: "ANMOL KUMARI" },
];

async function run() {
  await connectMongoDB();

  for (const rec of RECORDS) {
    const exists = await Certificate.findOne({ certificateNo: rec.certificateNo }).select("_id");
    if (exists) {
      console.log(`SKIP  ${rec.certificateNo} (${rec.studentName}) — already present.`);
      continue;
    }
    if (DRY) {
      console.log(`WOULD INSERT  ${rec.certificateNo} (${rec.studentName}).`);
      continue;
    }
    // Fresh synthetic userId per manual certificate (matches issueManualCertificate).
    await Certificate.create({ ...rec, userId: `manual:${randomUUID()}` });
    console.log(`INSERTED  ${rec.certificateNo} (${rec.studentName}).`);
  }

  await mongoose.connection.close();
  process.exit(0);
}

run().catch(async (err) => {
  console.error("Restore failed:", err.message);
  try { await mongoose.connection.close(); } catch { /* ignore */ }
  process.exit(1);
});
