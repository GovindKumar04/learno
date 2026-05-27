import mongoose from "mongoose";

const materialSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    type: {
      type: String,
      enum: ["pdf", "image", "video"],
      required: true,
    },
    url: { type: String, required: true },         // Cloudinary URL
    publicId: { type: String, required: true },    // For deletion
    module: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Module",
      required: true,
    },
    order: { type: Number, default: 0 },
    duration: { type: Number },                    // seconds, for videos
    size: { type: Number },                        // bytes
  },
  { timestamps: true }
);

export const Material = mongoose.model("Material", materialSchema);