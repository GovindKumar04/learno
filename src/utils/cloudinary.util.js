import cloudinary from "../config/cloudinary.js";
import fs from "fs";
import { ApiError } from "./ApiError.js";

const getResourceType = (mimetype) => {
  if (mimetype.startsWith("video/")) return "video";
  if (mimetype === "application/pdf") return "raw";
  return "image";
};

export const uploadToCloudinary = async (filePath, mimetype, folder = "course-materials") => {
  const resourceType = getResourceType(mimetype);
  try {
    const result = await cloudinary.uploader.upload(filePath, {
      folder,
      resource_type: resourceType,
      ...(resourceType === "video" && {
        eager: [{ streaming_profile: "hd", format: "m3u8" }],
        eager_async: true,
      }),
    });

    return {
      url: result.secure_url,
      publicId: result.public_id,
      resourceType,
      duration: result.duration || null,
      bytes: result.bytes,
    };
  } catch (error) {
    throw new ApiError(500, `Cloudinary upload failed: ${error.message}`);
  } finally {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
};

export const deleteFromCloudinary = async (publicId, resourceType = "image") => {
  try {
    return await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
  } catch (error) {
    throw new ApiError(500, `Cloudinary delete failed: ${error.message}`);
  }
};