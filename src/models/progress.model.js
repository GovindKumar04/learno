import mongoose from "mongoose";

const progressSchema = new mongoose.Schema(
  {
    userId: {
      type: String,       // user id
      required: true,
    },
    courseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
      required: true,
    },
    // Each entry records a single material watch event
    completedMaterials: [
      {
        materialId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Material",
          required: true,
        },
        watchedAt: {
          type: Date,
          default: Date.now,
        },
        // For videos: how far they got (0–100). Non-video materials default 100.
        watchPercent: {
          type: Number,
          default: 100,
          min: 0,
          max: 100,
        },
      },
    ],
    // Cached value updated on every mark-watched call
    completionPercent: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    lastAccessedAt: {
      type: Date,
      default: Date.now,
    },
    completedAt: {
      type: Date,
      default: null,   // set when completionPercent hits 100
    },
  },
  { timestamps: true }
);

// One progress doc per student per course
progressSchema.index({ userId: 1, courseId: 1 }, { unique: true });

export const Progress = mongoose.model("Progress", progressSchema);