import multer from "multer";
import path from "path";
import fs from "fs";

// Ensure temp folder exists
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
  const allowed = {
    "image/jpeg": true,
    "image/png": true,
    "image/webp": true,
    "application/pdf": true,
    "video/mp4": true,
    "video/mkv": true,
    "video/webm": true,
  };
  if (allowed[file.mimetype]) {
    cb(null, true);
  } else {
    cb(new Error(`Unsupported file type: ${file.mimetype}`), false);
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