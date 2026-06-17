import mongoose from "mongoose";
import { Blog } from "../models/blog.model.js";
import { ApiError } from "../utils/ApiError.js";
import { uploadToCloudinary, deleteFromCloudinary } from "../utils/cloudinary.util.js";
import { verifyAdminPassword } from "../utils/deleteGuard.util.js";
import { getOrSet, nsKey, bumpNs } from "../utils/cache.js";

const BLOGS_NS = "blogs";

const slugify = (s) =>
  String(s).toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "post";

// Ensure the slug is unique (append a short suffix on collision).
const uniqueSlug = async (base, excludeId = null) => {
  let slug = slugify(base);
  for (let i = 0; i < 6; i++) {
    const clash = await Blog.findOne({ slug, ...(excludeId && { _id: { $ne: excludeId } }) }).select("_id");
    if (!clash) return slug;
    slug = `${slugify(base)}-${Math.random().toString(36).slice(2, 6)}`;
  }
  return `${slugify(base)}-${Date.now().toString(36)}`;
};

const stripHtml = (html) => String(html || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
const computeReadTime = (html) => {
  const words = stripHtml(html).split(" ").filter(Boolean).length;
  return `${Math.max(1, Math.round(words / 200))} min read`;
};
const toBool = (v) => v === true || v === "true";

export const createBlogService = async ({ body, file, author }) => {
  const { title, content, category = "", excerpt = "", readTime = "", isPublished } = body;
  if (!title?.trim() || !content?.trim()) {
    throw new ApiError(400, "Title and content are required");
  }

  let coverImage = "", coverImagePublicId = "", coverImageType = "image";
  if (file) {
    const uploaded = await uploadToCloudinary(file.path, file.mimetype, "blog-covers");
    coverImage = uploaded.url;
    coverImagePublicId = uploaded.publicId;
    coverImageType = uploaded.resourceType === "video" ? "video" : "image";
  }

  const blog = await Blog.create({
    title: title.trim(),
    slug: await uniqueSlug(title),
    content,
    excerpt: excerpt.trim() || stripHtml(content).slice(0, 180),
    readTime: readTime.trim() || computeReadTime(content),
    category: category.trim(),
    coverImage,
    coverImagePublicId,
    coverImageType,
    author: author || "Fillip Skill Academy",
    isPublished: isPublished === undefined ? true : toBool(isPublished),
  });

  await bumpNs(BLOGS_NS);
  // Keep the collection capped — drop the oldest posts beyond MAX_BLOGS.
  await pruneOldBlogs();
  return blog;
};

// Only the most recent MAX_BLOGS posts are retained; adding a new post past the
// cap auto-deletes the oldest (and its cover image).
const MAX_BLOGS = 5;
const pruneOldBlogs = async () => {
  const count = await Blog.countDocuments();
  if (count <= MAX_BLOGS) return;
  const oldest = await Blog.find().sort({ createdAt: 1 }).limit(count - MAX_BLOGS);
  for (const b of oldest) {
    if (b.coverImagePublicId) {
      await deleteFromCloudinary(b.coverImagePublicId, b.coverImageType || "image").catch(() => {});
    }
    await Blog.findByIdAndDelete(b._id);
  }
  await bumpNs(BLOGS_NS);
};

export const getAllBlogsService = async ({ query, isAdmin }) => {
  const pageNum = Math.max(1, Number(query.page) || 1);
  const limitNum = Math.min(50, Math.max(1, Number(query.limit) || 12));
  const { search, category } = query;

  const runQuery = async () => {
    const filter = {};
    if (!isAdmin) filter.isPublished = true;
    if (category && category.trim()) filter.category = category.trim();
    if (search && search.trim()) {
      const regex = { $regex: search.trim(), $options: "i" };
      filter.$or = [{ title: regex }, { excerpt: regex }, { category: regex }];
    }

    const [blogs, total] = await Promise.all([
      Blog.find(filter).select("-content").skip((pageNum - 1) * limitNum).limit(limitNum).sort({ createdAt: -1 }),
      Blog.countDocuments(filter),
    ]);
    return { blogs, total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) };
  };

  if (isAdmin) return runQuery(); // admins see drafts + edit often → no cache
  const key = await nsKey(BLOGS_NS, `list:${pageNum}:${limitNum}:${category || ""}:${search || ""}`);
  return getOrSet(key, 300, runQuery);
};

// Resolve by Mongo _id or by slug.
const findByIdOrSlug = (idOrSlug) =>
  mongoose.isValidObjectId(idOrSlug)
    ? Blog.findById(idOrSlug)
    : Blog.findOne({ slug: idOrSlug });

export const getBlogService = async ({ idOrSlug, isAdmin }) => {
  const blog = await findByIdOrSlug(idOrSlug);
  if (!blog) throw new ApiError(404, "Blog post not found");
  if (!blog.isPublished && !isAdmin) throw new ApiError(404, "Blog post not found");
  return blog;
};

export const updateBlogService = async ({ id, body, file }) => {
  const blog = await Blog.findById(id);
  if (!blog) throw new ApiError(404, "Blog post not found");

  const { title, content, category, excerpt, readTime, isPublished, removeCover } = body;
  if (title !== undefined) blog.title = title.trim();
  if (category !== undefined) blog.category = category.trim();
  if (content !== undefined) blog.content = content;
  if (excerpt !== undefined) blog.excerpt = excerpt.trim();
  if (readTime !== undefined) blog.readTime = readTime.trim();
  if (isPublished !== undefined) blog.isPublished = toBool(isPublished);

  // Backfill derived fields if content changed but they weren't supplied.
  if (content !== undefined) {
    if (!blog.excerpt) blog.excerpt = stripHtml(content).slice(0, 180);
    if (!blog.readTime) blog.readTime = computeReadTime(content);
  }

  if (file) {
    // Replace the cover (image or video).
    if (blog.coverImagePublicId) await deleteFromCloudinary(blog.coverImagePublicId, blog.coverImageType || "image");
    const uploaded = await uploadToCloudinary(file.path, file.mimetype, "blog-covers");
    blog.coverImage = uploaded.url;
    blog.coverImagePublicId = uploaded.publicId;
    blog.coverImageType = uploaded.resourceType === "video" ? "video" : "image";
  } else if (toBool(removeCover)) {
    // Remove the cover entirely.
    if (blog.coverImagePublicId) await deleteFromCloudinary(blog.coverImagePublicId, blog.coverImageType || "image");
    blog.coverImage = "";
    blog.coverImagePublicId = "";
    blog.coverImageType = "image";
  }

  await blog.save();
  await bumpNs(BLOGS_NS);
  return blog;
};

export const deleteBlogService = async ({ id, password, adminId }) => {
  await verifyAdminPassword(adminId, password);

  const blog = await Blog.findById(id);
  if (!blog) throw new ApiError(404, "Blog post not found");

  if (blog.coverImagePublicId) await deleteFromCloudinary(blog.coverImagePublicId, blog.coverImageType || "image");
  await Blog.findByIdAndDelete(id);
  await bumpNs(BLOGS_NS);
};
