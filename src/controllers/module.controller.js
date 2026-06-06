import { Course } from "../models/course.model.js";
import { Module } from "../models/module.model.js";
import { Material } from "../models/material.model.js";
import { deleteFromCloudinary } from "../utils/cloudinary.util.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { hasOnlineCourseAccess, stripMaterialUrls } from "../utils/courseAccess.js";

// POST /api/courses/:courseId/modules
const createModule = asyncHandler(async (req, res) => {
  const course = await Course.findById(req.params.courseId);

  if (!course) {
    throw new ApiError(404, "Course not found");
  }

  const { title, description, order, topics, skills, project } = req.body;

  if (!title) throw new ApiError(400, "Module title is required");

  const mod = await Module.create({
    title,
    description,
    course: course._id,
    order: order ?? course.modules.length,
    topics: Array.isArray(topics) ? topics : [],
    skills: Array.isArray(skills) ? skills : [],
    project: project || "",
  });

  course.modules.push(mod._id);
  await course.save();

  return res
    .status(201)
    .json(new ApiResponse(201, mod, "Module created successfully"));
});

// GET /api/courses/:courseId/modules
// Material file URLs are returned only to admins / online-enrolled students;
// everyone else gets the curriculum outline (titles, types) with locked materials.
const getModules = asyncHandler(async (req, res) => {
  const modules = await Module.find({ course: req.params.courseId })
    .populate("materials")
    .sort("order");

  const plain = modules.map((m) => m.toObject());
  const allowed = await hasOnlineCourseAccess(req.user, req.params.courseId);
  if (!allowed) stripMaterialUrls(plain);

  return res.json(new ApiResponse(200, plain));
});

// PATCH /api/courses/:courseId/modules/:moduleId
const updateModule = asyncHandler(async (req, res) => {
  const mod = await Module.findOneAndUpdate(
    { _id: req.params.moduleId, course: req.params.courseId },
    { $set: req.body },
    { new: true, runValidators: true }
  );

  if (!mod) {
    throw new ApiError(404, "Module not found");
  }

  return res.json(new ApiResponse(200, mod, "Module updated successfully"));
});

// DELETE /api/courses/:courseId/modules/:moduleId
const deleteModule = asyncHandler(async (req, res) => {
  const mod = await Module.findById(req.params.moduleId).populate("materials");

  if (!mod) {
    throw new ApiError(404, "Module not found");
  }

  for (const mat of mod.materials) {
    const resType =
      mat.type === "video" ? "video" : mat.type === "pdf" ? "raw" : "image";
    await deleteFromCloudinary(mat.publicId, resType);
    await Material.findByIdAndDelete(mat._id);
  }

  await Course.findByIdAndUpdate(req.params.courseId, {
    $pull: { modules: mod._id },
  });

  await Module.findByIdAndDelete(mod._id);

  return res.json(new ApiResponse(200, null, "Module deleted successfully"));
});

export { createModule, getModules, updateModule, deleteModule };