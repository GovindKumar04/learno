import mongoose from "mongoose";

const enrollmentSchema = new mongoose.Schema(
  {
    userId: {
      type: String, // PostgreSQL user UUID
      required: true,
    },
    courseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
      required: true,
    },
    enrolledBy: {
      type: String, // admin's PG UUID who enrolled the student
      required: true,
    },
    enrollmentType: {
      type: String,
      enum: ["online", "offline"],
      default: "online",
    },

    isActive: {
      type: Boolean,
      default: true,
    },
    unenrolledAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true },
);

// Prevent duplicate enrollments for the same user+course. This compound index
// also serves the per-user lookups (userId is the prefix).
enrollmentSchema.index({ userId: 1, courseId: 1 }, { unique: true });

// Course-students listing: find({ courseId, isActive }).
enrollmentSchema.index({ courseId: 1, isActive: 1 });

// Admin "all enrollments" listing: find({ isActive }).sort({ createdAt: -1 }).
enrollmentSchema.index({ isActive: 1, createdAt: -1 });

export const Enrollment = mongoose.model("Enrollment", enrollmentSchema);
