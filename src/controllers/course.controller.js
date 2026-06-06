import { Course } from "../models/course.model.js";
import { Module } from "../models/module.model.js";
import { Material } from "../models/material.model.js";
import { Enrollment } from "../models/enrollment.model.js";
import { Progress } from "../models/progress.model.js";
import { uploadToCloudinary, deleteFromCloudinary } from "../utils/cloudinary.util.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { hasOnlineCourseAccess, stripMaterialUrls } from "../utils/courseAccess.js";

const createCourse = asyncHandler(async (req, res) => {
  const { title, description, category, level, price, priceOnline, priceOffline, modes, isPublished, totalClasses } = req.body;
  if (!title || !description || !category) {
    throw new ApiError(400, "title, description, and category are required");
  }

  // modes may arrive as a JSON string (FormData), an array, or a single value.
  let parsedModes;
  if (modes !== undefined) {
    try { parsedModes = typeof modes === "string" ? JSON.parse(modes) : modes; }
    catch { parsedModes = [].concat(modes); }
  }

  const willPublish = isPublished === true || isPublished === "true";
  if (willPublish) {
    const hasPrice = Number(price) > 0 || Number(priceOnline) > 0 || Number(priceOffline) > 0;
    if (!hasPrice) throw new ApiError(400, "Assign a price before publishing this course");
  }

  let thumbnail, thumbnailPublicId;
  if (req.file) {
    const uploaded = await uploadToCloudinary(req.file.path, req.file.mimetype, "course-thumbnails");
    thumbnail = uploaded.url;
    thumbnailPublicId = uploaded.publicId;
  }

  const course = await Course.create({
    title, description, category, level,
    price: price || 0,
    priceOnline: priceOnline || 0,
    priceOffline: priceOffline || 0,
    totalClasses: Number(totalClasses) || 0,
    ...(parsedModes && { modes: parsedModes }),
    isPublished: willPublish,
    thumbnail, thumbnailPublicId,
    createdBy: req.user.id,
  });

  return res.status(201).json(new ApiResponse(201, course, "Course created successfully"));
});

const getAllCourses = asyncHandler(async (req, res) => {
  const pageNum  = Number(req.query.page)  || 1;
  const limitNum = Number(req.query.limit) || 10;
  const { search, category, level } = req.query;

  const filter = {};
  if (!req.user || req.user.role !== "admin") filter.isPublished = true;

  if (category && category.trim()) filter.category = { $regex: category.trim(), $options: "i" };
  if (level    && level.trim())    filter.level    = level.trim();

  if (search && search.trim()) {
    const regex = { $regex: search.trim(), $options: "i" };
    filter.$or = [
      { title: regex },
      { category: regex },
      { description: regex },
    ];
  }

  const [courses, total] = await Promise.all([
    Course.find(filter)
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum)
      .select("-modules")
      .sort({ createdAt: -1 }),
    Course.countDocuments(filter),
  ]);

  return res.json(new ApiResponse(200, { courses, total, page: pageNum, limit: limitNum }));
});

// GET /courses/categories — distinct categories (published only for non-admins)
const getCourseCategories = asyncHandler(async (req, res) => {
  const filter = {};
  if (!req.user || req.user.role !== "admin") filter.isPublished = true;

  const categories = await Course.distinct("category", filter);
  return res.json(new ApiResponse(200, categories.filter(Boolean).sort()));
});

const getCourseById = asyncHandler(async (req, res) => {
  const course = await Course.findById(req.params.courseId).populate({
    path: "modules",
    populate: { path: "materials" },
  });

  if (!course) throw new ApiError(404, "Course not found");
  if (!course.isPublished && req.user?.role !== "admin") {
    throw new ApiError(403, "This course is not published yet");
  }

  const obj = course.toObject();
  if (!(await hasOnlineCourseAccess(req.user, course._id))) {
    stripMaterialUrls(obj.modules);
  }

  return res.json(new ApiResponse(200, obj));
});

const getCourseBySlug = asyncHandler(async (req, res) => {
  const course = await Course.findOne({ slug: req.params.slug }).populate({
    path: "modules",
    options: { sort: { order: 1 } },
    populate: { path: "materials" },
  });

  if (!course) throw new ApiError(404, "Course not found");
  if (!course.isPublished && req.user?.role !== "admin") {
    throw new ApiError(403, "This course is not published yet");
  }

  const obj = course.toObject();
  if (!(await hasOnlineCourseAccess(req.user, course._id))) {
    stripMaterialUrls(obj.modules);
  }

  return res.json(new ApiResponse(200, obj));
});

const updateCourse = asyncHandler(async (req, res) => {
  const course = await Course.findById(req.params.courseId);
  if (!course) throw new ApiError(404, "Course not found");

  const scalarFields = [
    "title", "description", "category", "level", "price",
    "isPublished", "language", "duration", "priceOnline", "priceOffline",
    "totalClasses", "slug", "tag", "subtitle", "tagline", "heroImg",
  ];
  scalarFields.forEach((field) => {
    if (req.body[field] !== undefined) course[field] = req.body[field];
  });

  // Array and object fields sent as JSON strings from FormData
  const jsonArrayFields = [
    "benefits", "prerequisites", "targetAudience", "demandReasons",
    "highlights", "learnPoints", "faqs", "modes",
  ];
  jsonArrayFields.forEach((field) => {
    if (req.body[field] !== undefined) {
      try { course[field] = JSON.parse(req.body[field]); } catch { /* ignore bad JSON */ }
    }
  });

  const jsonObjectFields = ["whyChooseUs", "industry"];
  jsonObjectFields.forEach((field) => {
    if (req.body[field] !== undefined) {
      try { course[field] = JSON.parse(req.body[field]); } catch { /* ignore */ }
    }
  });

  if (req.file) {
    if (course.thumbnailPublicId) await deleteFromCloudinary(course.thumbnailPublicId, "image");
    const uploaded = await uploadToCloudinary(req.file.path, req.file.mimetype, "course-thumbnails");
    course.thumbnail = uploaded.url;
    course.thumbnailPublicId = uploaded.publicId;
  }

  // A course can't go live without a price assigned.
  if (course.isPublished) {
    const hasPrice = course.price > 0 || course.priceOnline > 0 || course.priceOffline > 0;
    if (!hasPrice) {
      throw new ApiError(400, "Assign a price before publishing this course");
    }
  }

  await course.save();
  return res.json(new ApiResponse(200, course, "Course updated successfully"));
});

const deleteCourse = asyncHandler(async (req, res) => {
  const course = await Course.findById(req.params.courseId).populate({
    path: "modules",
    populate: { path: "materials" },
  });

  if (!course) throw new ApiError(404, "Course not found");

  if (course.thumbnailPublicId) await deleteFromCloudinary(course.thumbnailPublicId, "image");

  // FIX: parallel deletion for performance
  await Promise.all(
    course.modules.map(async (mod) => {
      await Promise.all(
        mod.materials.map(async (mat) => {
          const resType = mat.type === "video" ? "video" : mat.type === "pdf" ? "raw" : "image";
          await deleteFromCloudinary(mat.publicId, resType);
          await Material.findByIdAndDelete(mat._id);
        })
      );
      await Module.findByIdAndDelete(mod._id);
    })
  );

  // Remove related enrollments and progress so they don't become orphans.
  await Promise.all([
    Enrollment.deleteMany({ courseId: course._id }),
    Progress.deleteMany({ courseId: course._id }),
  ]);

  await Course.findByIdAndDelete(course._id);
  return res.json(new ApiResponse(200, null, "Course deleted successfully"));
});

export { createCourse, getAllCourses, getCourseCategories, getCourseById, getCourseBySlug, updateCourse, deleteCourse };