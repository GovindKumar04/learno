import { Course } from "../models/course.model.js";
import { Module } from "../models/module.model.js";
import { Material } from "../models/material.model.js";
import { deleteFromCloudinary } from "../utils/cloudinary.util.js";
import { ApiError } from "../utils/ApiError.js";
import { hasOnlineCourseAccess, stripMaterialUrls } from "../utils/courseAccess.js";
import { verifyAdminPassword, assertNoDependents } from "../utils/deleteGuard.util.js";

export const createModuleService = async ({ courseId, title, description, order, topics, skills, project }) => {
  const course = await Course.findById(courseId);
  if (!course) throw new ApiError(404, "Course not found");
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
  return mod;
};

// Material file URLs are returned only to admins / online-enrolled students;
// everyone else gets the curriculum outline with locked materials.
export const getModulesService = async ({ courseId, user }) => {
  const modules = await Module.find({ course: courseId }).populate("materials").sort("order");
  const plain = modules.map((m) => m.toObject());
  const allowed = await hasOnlineCourseAccess(user, courseId);
  if (!allowed) {
    stripMaterialUrls(plain);
  } else {
    // PDFs can't be delivered from Cloudinary's CDN when PDF delivery is restricted,
    // so serve them through our authenticated streaming proxy instead. Videos/images
    // deliver fine from the CDN and keep their direct URLs.
    for (const mod of plain) {
      if (!Array.isArray(mod.materials)) continue;
      for (const mat of mod.materials) {
        if (mat.type === "pdf") mat.url = `/api/courses/${courseId}/materials/${mat._id}/file`;
      }
    }
  }
  return plain;
};

export const updateModuleService = async ({ courseId, moduleId, updates }) => {
  const mod = await Module.findOneAndUpdate(
    { _id: moduleId, course: courseId },
    { $set: updates },
    { new: true, runValidators: true }
  );
  if (!mod) throw new ApiError(404, "Module not found");
  return mod;
};

export const deleteModuleService = async ({ courseId, moduleId, password, adminId }) => {
  await verifyAdminPassword(adminId, password);

  const mod = await Module.findById(moduleId);
  if (!mod) throw new ApiError(404, "Module not found");

  // Block while it still has materials — delete those first.
  const materials = await Material.countDocuments({ module: moduleId });
  assertNoDependents("module", [{ label: "material(s)", count: materials }]);

  await Course.findByIdAndUpdate(courseId, { $pull: { modules: mod._id } });
  await Module.findByIdAndDelete(mod._id);
};
