import mongoose from "mongoose";

const scholarshipSchema = new mongoose.Schema(
  {
    userId: {
      type: String, // user id
      required: true,
    },

    track: {
      type: String,
      enum: ["merit", "need", "women", "early"],
      required: true,
    },

    courseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
      required: true,
    },

    statement: {
      type: String,
      required: true,
      trim: true,
    },

    income: {
      type: String, // free text, optional (mainly for need-based)
      default: "",
    },

    documents: [
      {
        url: { type: String, required: true },
        publicId: { type: String, required: true },
      },
    ],

    status: {
      type: String,
      enum: ["pending", "under_review", "approved", "rejected"],
      default: "pending",
    },

    discountPercent: {
      type: Number, // set by admin on approval (0–100)
      default: 0,
      min: 0,
      max: 100,
    },

    used: {
      type: Boolean, // flips true after the discounted payment succeeds
      default: false,
    },

    adminNote: {
      type: String,
      default: "",
    },

    reviewedBy: {
      type: String, // admin user id
      default: null,
    },

    reviewedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

// A student can only have one active (pending/approved) application per course.
// Partial index lets old rejected ones not block re-application.
scholarshipSchema.index({ userId: 1, courseId: 1, status: 1 });

export const Scholarship = mongoose.model("Scholarship", scholarshipSchema);
