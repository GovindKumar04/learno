import { Module } from "../models/module.model.js";
import { Material } from "../models/material.model.js";
import { uploadToCloudinary, deleteFromCloudinary } from "../utils/cloudinary.util.js";
import { ApiError } from "../utils/ApiError.js";
import cloudinary from "../config/cloudinary.js";
import { hasOnlineCourseAccess } from "../utils/courseAccess.js";
import { verifyAdminPassword } from "../utils/deleteGuard.util.js";

// Resolve an authenticated, short-lived Cloudinary download URL for a material the
// signed-in user is allowed to view. Used by the streaming proxy so PDFs work even
// when the account's CDN PDF delivery is restricted — the API download endpoint
// bypasses that restriction (the CDN secure_url returns 401 for PDFs/ZIPs).
export const getMaterialFileService = async ({ courseId, materialId, user }) => {
  const allowed = await hasOnlineCourseAccess(user, courseId);
  if (!allowed) throw new ApiError(403, "You don't have access to this material");

  const material = await Material.findById(materialId).populate({ path: "module", select: "course" });
  if (!material || String(material.module?.course) !== String(courseId)) {
    throw new ApiError(404, "Material not found");
  }

  const resourceType = material.type === "video" ? "video" : material.type === "pdf" ? "raw" : "image";
  const downloadUrl = cloudinary.utils.private_download_url(material.publicId, null, {
    resource_type: resourceType,
    type: "upload",
  });
  const contentType = material.type === "pdf" ? "application/pdf" : "application/octet-stream";
  const safeTitle = (material.title || "material").replace(/[^a-zA-Z0-9._-]+/g, "_");
  return { downloadUrl, contentType, filename: `${safeTitle}.${material.type === "pdf" ? "pdf" : "bin"}` };
};

const mimetypeToType = (mimetype) => {
  if (mimetype.startsWith("video/")) return "video";
  if (mimetype === "application/pdf") return "pdf";
  if (mimetype.startsWith("image/")) return "image";
  return null;
};

export const uploadMaterialsService = async ({ courseId, moduleId, files, titlesRaw }) => {
  const mod = await Module.findOne({ _id: moduleId, course: courseId });
  if (!mod) throw new ApiError(404, "Module not found");
  if (!files || files.length === 0) throw new ApiError(400, "No files uploaded");

  // titles can be sent as JSON array: '["Intro", "Notes"]'
  let titles = [];
  if (titlesRaw) {
    try {
      titles = JSON.parse(titlesRaw);
    } catch {
      titles = titlesRaw.split(",").map((t) => t.trim());
    }
  }

  const savedMaterials = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const type = mimetypeToType(file.mimetype);
    if (!type) throw new ApiError(400, `Unsupported file type for: ${file.originalname}`);

    const uploaded = await uploadToCloudinary(
      file.path,
      file.mimetype,
      `courses/${courseId}/modules/${moduleId}`
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
  return savedMaterials;
};

export const deleteMaterialService = async ({ moduleId, materialId, password, adminId }) => {
  await verifyAdminPassword(adminId, password);

  const material = await Material.findById(materialId);
  if (!material) throw new ApiError(404, "Material not found");

  const resType = material.type === "video" ? "video" : material.type === "pdf" ? "raw" : "image";
  await deleteFromCloudinary(material.publicId, resType);

  await Module.findByIdAndUpdate(moduleId, { $pull: { materials: material._id } });
  await Material.findByIdAndDelete(material._id);
};
