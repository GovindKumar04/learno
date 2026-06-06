import mongoose from "mongoose";

// A record of every certificate Fillip Skill Academy has issued.
// One certificate per student per course (re-issuing updates the same row,
// keeping a stable certificate number).
const certificateSchema = new mongoose.Schema(
  {
    userId: {
      type: String, // PostgreSQL user UUID (role = student)
      required: true,
    },
    courseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
      required: true,
    },
    // Human-readable certificate id, e.g. FSA-CERT-26-0001 — printed on the PDF.
    certificateNo: {
      type: String,
      required: true,
      unique: true,
    },
    // Snapshot of the names at issue time (so the record is stable even if the
    // user later renames or the course title changes).
    studentName: { type: String, required: true },
    courseName: { type: String, required: true },
    email: { type: String, required: true },
    issuedBy: {
      type: String, // admin's PG UUID who issued it
      required: true,
    },
    issuedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

// One certificate per student+course
certificateSchema.index({ userId: 1, courseId: 1 }, { unique: true });

export const Certificate = mongoose.model("Certificate", certificateSchema);
