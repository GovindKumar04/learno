import multer from "multer";
import path from "path";
import fs from "fs";

const tempDir = "./uploads/temp";
if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, tempDir),
  filename: (req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${unique}${path.extname(file.originalname)}`);
  },
});

const fileFilter = (req, file, cb) => {
  // Prefix-based to match the downstream type detection in material.service.js and
  // cloudinary.util.js. This accepts any image or video container — e.g. MKV reports
  // as "video/x-matroska" (NOT "video/mkv"), MOV as "video/quicktime", etc. — plus PDFs.
  const mime = file.mimetype || "";
  const ok = mime.startsWith("image/") || mime.startsWith("video/") || mime === "application/pdf";
  if (ok) {
    cb(null, true);
  } else {
    cb(new Error(`Unsupported file type: ${mime || "unknown"}`), false);
  }
};

export const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB max
});

// For admin email attachments — accepts any file type (docs, sheets, zips, …),
// capped well under typical SMTP limits.
export const uploadAttachments = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB per file
});

// Avatars / thumbnails — images only, small cap. Prevents any authenticated user
// from uploading a huge (or non-image) file to a profile field (storage DoS).
const imageOnly = (req, file, cb) => {
  const ok = (file.mimetype || "").startsWith("image/");
  cb(ok ? null : new Error("Only image files are allowed here"), ok);
};
export const uploadImage = multer({
  storage,
  fileFilter: imageOnly,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});