import mongoose from "mongoose";

const courseSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, required: true },
    thumbnail: { type: String },                   // Cloudinary URL
    thumbnailPublicId: { type: String },           // For deletion
    category: { type: String, required: true },
    level: {
      type: String,
      enum: ["beginner", "intermediate", "advanced"],
      default: "beginner",
    },
    price: { type: Number, default: 0 },
    isPublished: { type: Boolean, default: false },
    createdBy: {
      type: String,                                // UUID from your PG users table
      required: true,
    },
    modules: [{ type: mongoose.Schema.Types.ObjectId, ref: "Module" }],
  },
  { timestamps: true }
);

export const Course = mongoose.model("Course", courseSchema);