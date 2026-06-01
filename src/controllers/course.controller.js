import { Course } from "../models/course.model.js";
import { Module } from "../models/module.model.js";
import { Material } from "../models/material.model.js";
import { uploadToCloudinary, deleteFromCloudinary } from "../utils/cloudinary.util.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";

const createCourse = asyncHandler(async (req, res) => {
  const { title, description, category, level, price } = req.body;
  if (!title || !description || !category) {
    throw new ApiError(400, "title, description, and category are required");
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
    thumbnail, thumbnailPublicId,
    createdBy: req.user.id,
  });

  return res.status(201).json(new ApiResponse(201, course, "Course created successfully"));
});

const getAllCourses = asyncHandler(async (req, res) => {
  const pageNum = Number(req.query.page) || 1;
  const limitNum = Number(req.query.limit) || 10;
  const { search } = req.query;

  const filter = {};
  if (req.user.role !== "admin") filter.isPublished = true;

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

const getCourseById = asyncHandler(async (req, res) => {
  const course = await Course.findById(req.params.courseId).populate({
    path: "modules",
    populate: { path: "materials" },
  });

  if (!course) throw new ApiError(404, "Course not found");
  if (!course.isPublished && req.user.role !== "admin") {
    throw new ApiError(403, "This course is not published yet");
  }

  return res.json(new ApiResponse(200, course));
});

const updateCourse = asyncHandler(async (req, res) => {
  const course = await Course.findById(req.params.courseId);
  if (!course) throw new ApiError(404, "Course not found");

  const allowedUpdates = ["title", "description", "category", "level", "price", "isPublished"];
  allowedUpdates.forEach((field) => {
    if (req.body[field] !== undefined) course[field] = req.body[field];
  });

  if (req.file) {
    if (course.thumbnailPublicId) await deleteFromCloudinary(course.thumbnailPublicId, "image");
    const uploaded = await uploadToCloudinary(req.file.path, req.file.mimetype, "course-thumbnails");
    course.thumbnail = uploaded.url;
    course.thumbnailPublicId = uploaded.publicId;
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

  await Course.findByIdAndDelete(course._id);
  return res.json(new ApiResponse(200, null, "Course deleted successfully"));
});

export { createCourse, getAllCourses, getCourseById, updateCourse, deleteCourse };