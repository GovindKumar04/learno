import fs from "fs";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import {
  createBlogService,
  getAllBlogsService,
  getBlogService,
  updateBlogService,
  deleteBlogService,
} from "../services/blog.service.js";

const isAdmin = (req) => req.user?.role === "admin";

// GET /blogs  — public (published only) unless an admin passes ?all=1
export const getBlogs = asyncHandler(async (req, res) => {
  const admin = isAdmin(req) && (req.query.all === "1" || req.query.all === "true");
  const data = await getAllBlogsService({ query: req.query, isAdmin: admin });
  return res.json(new ApiResponse(200, data));
});

// GET /blogs/:idOrSlug  — public; admins can also fetch drafts
export const getBlog = asyncHandler(async (req, res) => {
  const blog = await getBlogService({ idOrSlug: req.params.idOrSlug, isAdmin: isAdmin(req) });
  return res.json(new ApiResponse(200, blog));
});

// POST /blogs  (admin) — multipart, field "image"
export const createBlog = asyncHandler(async (req, res) => {
  try {
    const blog = await createBlogService({ body: req.body, file: req.file, author: req.user?.full_name });
    return res.status(201).json(new ApiResponse(201, blog, "Blog created"));
  } finally {
    if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
  }
});

// PATCH /blogs/:id  (admin)
export const updateBlog = asyncHandler(async (req, res) => {
  try {
    const blog = await updateBlogService({ id: req.params.id, body: req.body, file: req.file });
    return res.json(new ApiResponse(200, blog, "Blog updated"));
  } finally {
    if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
  }
});

// DELETE /blogs/:id  (admin)
export const deleteBlog = asyncHandler(async (req, res) => {
  await deleteBlogService({ id: req.params.id, password: req.body?.password, adminId: req.user.id });
  return res.json(new ApiResponse(200, {}, "Blog deleted"));
});
