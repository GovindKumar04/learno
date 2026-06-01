import mongoose from "mongoose";

const reviewSchema = new mongoose.Schema(
  {
    userId: {
      type: String, // PG UUID
      required: true,
    },

    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
    },

    comment: {
      type: String,
      trim: true,
    },

    isFeatured: {
      type: Boolean,
      default: false,
    },

    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false },
);

const courseSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },

    description: {
      type: String,
      required: true,
    },

    thumbnail: {
      type: String,
    },

    thumbnailPublicId: {
      type: String,
    },

    category: {
      type: String,
      required: true,
    },

    level: {
      type: String,
      enum: ["beginner", "intermediate", "advanced"],
      default: "beginner",
    },

    price: {
      type: Number,
      default: 0,
    },

    isPublished: {
      type: Boolean,
      default: false,
    },

    createdBy: {
      type: String, // PG UUID
      required: true,
    },

    modules: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Module",
      },
    ],

    // =========================
    // NEW FIELDS
    // =========================

    prerequisites: [
      {
        type: String,
      },
    ],

    benefits: [
      {
        type: String,
      },
    ],

    targetAudience: [
      {
        type: String,
      },
    ],

    language: {
      type: String,
      default: "English",
    },

    totalDuration: {
      type: Number, // minutes
      default: 0,
    },


    totalStudentsEnrolled: {
      type: Number,
      default: 0,
    },

    averageRating: {
      type: Number,
      default: 0,
    },

    totalReviews: {
      type: Number,
      default: 0,
    },

    reviews: [reviewSchema],
  },
  { timestamps: true },
);

export const Course = mongoose.model("Course", courseSchema);
