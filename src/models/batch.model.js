import mongoose from "mongoose";

const batchSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    courseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
      required: true,
    },
    // Assigned instructor — must have an APPROVED teaching request for this course
    instructorId: {
      type: String, // PG UUID
      required: true,
    },
    // Offline students hand-picked by admin (offline-enrolled in the course)
    studentIds: [
      {
        type: String, // PG UUID
      },
    ],
    schedule: {
      type: String, // e.g. "Mon–Fri, 7:00 PM - 9:00 PM"
      default: "",
    },
    location: {
      type: String, // offline venue / address
      default: "",
    },
    // A batch groups either classroom (in-person) students or live (Zoom/Meet)
    // students under one instructor and schedule.
    mode: {
      type: String,
      enum: ["classroom", "live"],
      default: "classroom",
    },
    seats: {
      type: Number,
      default: 0,
    },
    status: {
      type: String,
      enum: ["upcoming", "ongoing", "completed"],
      default: "upcoming",
    },
    createdBy: {
      type: String, // admin PG UUID
      required: true,
    },
  },
  { timestamps: true },
);

export const Batch = mongoose.model("Batch", batchSchema);
