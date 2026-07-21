import mongoose from "mongoose";

const blogSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },

    
    slug: { type: String, required: true, unique: true, trim: true },

   
    excerpt: { type: String, default: "" },

   
    content: { type: String, required: true },

    coverImage: { type: String, default: "" },
    coverImagePublicId: { type: String, default: "" },
    
    coverImageType: { type: String, enum: ["image", "video"], default: "image" },

    category: { type: String, default: "", trim: true },
    readTime: { type: String, default: "" },

    author: { type: String, default: "Fillip Skill Academy" },

    isPublished: { type: Boolean, default: true },
  },
  { timestamps: true }
);


blogSchema.index({ isPublished: 1, createdAt: -1 });

export const Blog = mongoose.model("Blog", blogSchema);
