import mongoose from "mongoose";

// One status entry per student within a session
const recordSchema = new mongoose.Schema(
  {
    studentId: { type: String, required: true }, // PG UUID
    status: {
      type: String,
      enum: ["present", "absent", "leave"],
      default: "present",
    },
  },
  { _id: false },
);

// One attendance session = one batch on one calendar day
const attendanceSchema = new mongoose.Schema(
  {
    batchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Batch",
      required: true,
    },
    courseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
    },
    // Stored as "YYYY-MM-DD" → day-level uniqueness, timezone-safe
    date: {
      type: String,
      required: true,
    },
    records: [recordSchema],
    markedBy: {
      type: String, // instructor / admin PG UUID
      required: true,
    },
  },
  { timestamps: true },
);

// One session per batch per day
attendanceSchema.index({ batchId: 1, date: 1 }, { unique: true });

export const Attendance = mongoose.model("Attendance", attendanceSchema);
