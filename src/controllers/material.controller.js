import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { ApiError } from "../utils/ApiError.js";
import { uploadMaterialsService, deleteMaterialService, getMaterialFileService } from "../services/material.service.js";

// POST /api/courses/:courseId/modules/:moduleId/materials
const uploadMaterials = asyncHandler(async (req, res) => {
  const savedMaterials = await uploadMaterialsService({
    courseId: req.params.courseId,
    moduleId: req.params.moduleId,
    files: req.files,
    titlesRaw: req.body.titles,
  });
  return res
    .status(201)
    .json(new ApiResponse(201, savedMaterials, `${savedMaterials.length} material(s) uploaded successfully`));
});

// DELETE /api/courses/:courseId/modules/:moduleId/materials/:materialId
const deleteMaterial = asyncHandler(async (req, res) => {
  await deleteMaterialService({
    moduleId: req.params.moduleId,
    materialId: req.params.materialId,
    password: req.body?.password,
    adminId: req.user.id,
  });
  return res.json(new ApiResponse(200, null, "Material deleted successfully"));
});

// GET /api/courses/:courseId/materials/:materialId/file
// Streams the material (PDF) inline by proxying Cloudinary's authenticated API
// download endpoint — works regardless of the account's CDN PDF-delivery setting.
const streamMaterialFile = asyncHandler(async (req, res) => {
  const { downloadUrl, contentType, filename } = await getMaterialFileService({
    courseId: req.params.courseId,
    materialId: req.params.materialId,
    user: req.user,
  });

  const upstream = await fetch(downloadUrl);
  if (!upstream.ok) throw new ApiError(502, "Failed to fetch the material file");

  const buf = Buffer.from(await upstream.arrayBuffer());
  res.setHeader("Content-Type", contentType);
  res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
  res.setHeader("Content-Length", buf.length);
  res.setHeader("Cache-Control", "private, max-age=300");
  return res.send(buf);
});

export { uploadMaterials, deleteMaterial, streamMaterialFile };
