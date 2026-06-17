import mongoose from "mongoose";

const blogSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },

    // URL-friendly unique identifier, derived from the title.
    slug: { type: String, required: true, unique: true, trim: true },

    // Short summary for cards / SEO. Auto-derived from content if not given.
    excerpt: { type: String, default: "" },

    // Full post body — HTML produced by the rich-text editor.
    content: { type: String, required: true },

    coverImage: { type: String, default: "" },
    coverImagePublicId: { type: String, default: "" },
    // "image" or "video" — drives how the cover is rendered (img vs video) and
    // how it's deleted from Cloudinary.
    coverImageType: { type: String, enum: ["image", "video"], default: "image" },

    category: { type: String, default: "", trim: true },
    readTime: { type: String, default: "" }, // e.g. "5 min read"

    author: { type: String, default: "Fillip Skill Academy" },

    isPublished: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// Public listing queries published posts, newest first.
blogSchema.index({ isPublished: 1, createdAt: -1 });

export const Blog = mongoose.model("Blog", blogSchema);
