import mongoose from "mongoose";

const teachingRequestSchema = new mongoose.Schema(
  {
    instructorId: {
      type: String, // PostgreSQL user UUID (role = instructor)
      required: true,
    },
    courseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
      required: true,
    },
    message: {
      type: String,
      trim: true,
      default: "",
    },
    // Approval to teach a course (covers classroom batches and live classes).
    mode: {
      type: String,
      enum: ["classroom"],
      default: "classroom",
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected", "withdrawn"],
      default: "pending",
    },
    reviewedBy: {
      type: String, // admin's PG UUID who approved/rejected
      default: null,
    },
    reviewedAt: {
      type: Date,
      default: null,
    },
    // When the instructor withdrew their own request. Drives a re-apply hold
    // (they can't request the same course again until HOLD_DAYS have passed).
    withdrawnAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true },
);

// One request per instructor+course (re-request handled by re-opening the row)
teachingRequestSchema.index({ instructorId: 1, courseId: 1 }, { unique: true });

export const TeachingRequest = mongoose.model("TeachingRequest", teachingRequestSchema);
