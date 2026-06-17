import fs from "fs";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import {
  createTestimonialService,
  getAllTestimonialsService,
  updateTestimonialService,
  deleteTestimonialService,
} from "../services/testimonial.service.js";

const isAdmin = (req) => req.user?.role === "admin";

// GET /testimonials — scoped by ?courseId (omit for global/homepage).
// Admins can pass ?all=1 to include drafts and every course.
export const getTestimonials = asyncHandler(async (req, res) => {
  const admin = isAdmin(req) && (req.query.all === "1" || req.query.all === "true");
  const data = await getAllTestimonialsService({ isAdmin: admin, courseId: req.query.courseId });
  return res.json(new ApiResponse(200, data));
});

// POST /testimonials (admin) — multipart, field "image"
export const createTestimonial = asyncHandler(async (req, res) => {
  try {
    const t = await createTestimonialService({ body: req.body, file: req.file });
    return res.status(201).json(new ApiResponse(201, t, "Testimonial added"));
  } finally {
    if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
  }
});

// PATCH /testimonials/:id (admin)
export const updateTestimonial = asyncHandler(async (req, res) => {
  try {
    const t = await updateTestimonialService({ id: req.params.id, body: req.body, file: req.file });
    return res.json(new ApiResponse(200, t, "Testimonial updated"));
  } finally {
    if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
  }
});

// DELETE /testimonials/:id (admin)
export const deleteTestimonial = asyncHandler(async (req, res) => {
  await deleteTestimonialService({ id: req.params.id, password: req.body?.password, adminId: req.user.id });
  return res.json(new ApiResponse(200, {}, "Testimonial deleted"));
});
