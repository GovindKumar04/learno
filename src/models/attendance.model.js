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

// One attendance session = either one classroom batch on one calendar day
// (batchId set) OR one live (Zoom/Meet) session (onlineClassId set).
const attendanceSchema = new mongoose.Schema(
  {
    // Classroom attendance: which batch this session belongs to.
    batchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Batch",
    },
    // Live attendance: which scheduled live class this session belongs to.
    // Exactly one of batchId / onlineClassId is set per document.
    onlineClassId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "OnlineClass",
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

// One session per batch per day (only enforced for classroom docs that have a batchId).
attendanceSchema.index(
  { batchId: 1, date: 1 },
  { unique: true, partialFilterExpression: { batchId: { $exists: true } } },
);

// One attendance record per live class session.
attendanceSchema.index(
  { onlineClassId: 1 },
  { unique: true, partialFilterExpression: { onlineClassId: { $exists: true } } },
);

export const Attendance = mongoose.model("Attendance", attendanceSchema);
