import { Module } from "../models/module.model.js";
import { Material } from "../models/material.model.js";
import { uploadToCloudinary, deleteFromCloudinary } from "../utils/cloudinary.util.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";

const mimetypeToType = (mimetype) => {
  if (mimetype.startsWith("video/")) return "video";
  if (mimetype === "application/pdf") return "pdf";
  if (mimetype.startsWith("image/")) return "image";
  return null;
};

// POST /api/courses/:courseId/modules/:moduleId/materials
const uploadMaterials = asyncHandler(async (req, res) => {
  const mod = await Module.findOne({
    _id: req.params.moduleId,
    course: req.params.courseId,
  });

  if (!mod) {
    throw new ApiError(404, "Module not found");
  }

  if (!req.files || req.files.length === 0) {
    throw new ApiError(400, "No files uploaded");
  }

  // titles can be sent as JSON array: '["Intro", "Notes"]'
  let titles = [];
  if (req.body.titles) {
    try {
      titles = JSON.parse(req.body.titles);
    } catch {
      titles = req.body.titles.split(",").map((t) => t.trim());
    }
  }

  const savedMaterials = [];

  for (let i = 0; i < req.files.length; i++) {
    const file = req.files[i];
    const type = mimetypeToType(file.mimetype);

    if (!type) {
      throw new ApiError(400, `Unsupported file type for: ${file.originalname}`);
    }

    const uploaded = await uploadToCloudinary(
      file.path,
      file.mimetype,
      `courses/${req.params.courseId}/modules/${req.params.moduleId}`
    );

    const material = await Material.create({
      title: titles[i] || file.originalname,
      type,
      url: uploaded.url,
      publicId: uploaded.publicId,
      module: mod._id,
      order: mod.materials.length + i,
      duration: uploaded.duration,
      size: uploaded.bytes,
    });

    mod.materials.push(material._id);
    savedMaterials.push(material);
  }

  await mod.save();

  return res
    .status(201)
    .json(
      new ApiResponse(
        201,
        savedMaterials,
        `${savedMaterials.length} material(s) uploaded successfully`
      )
    );
});

// DELETE /api/courses/:courseId/modules/:moduleId/materials/:materialId
const deleteMaterial = asyncHandler(async (req, res) => {
  const material = await Material.findById(req.params.materialId);

  if (!material) {
    throw new ApiError(404, "Material not found");
  }

  const resType =
    material.type === "video" ? "video" : material.type === "pdf" ? "raw" : "image";

  await deleteFromCloudinary(material.publicId, resType);

  await Module.findByIdAndUpdate(req.params.moduleId, {
    $pull: { materials: material._id },
  });

  await Material.findByIdAndDelete(material._id);

  return res.json(new ApiResponse(200, null, "Material deleted successfully"));
});

export { uploadMaterials, deleteMaterial };