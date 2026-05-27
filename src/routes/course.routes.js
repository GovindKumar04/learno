import express from "express";
import {
  createCourse,
  getAllCourses,
  getCourseById,
  updateCourse,
  deleteCourse,
} from "../controllers/course.controller.js";
import {
  createModule,
  getModules,
  updateModule,
  deleteModule,
} from "../controllers/module.controller.js";
import {
  uploadMaterials,
  deleteMaterial,
} from "../controllers/material.controller.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";
import { requireRole } from "../middlewares/role.middleware.js";
import { upload } from "../middlewares/multer.middleware.js";

const courseRouter = express.Router();


courseRouter.use(verifyJWT);

// ─── Courses ──────────────────────────────────────────────
courseRouter.post(
  "/",
  requireRole("admin"),
  upload.single("thumbnail"), // optional thumbnail image
  createCourse,
);
courseRouter.get("/", getAllCourses); // students see published only
courseRouter.get("/:courseId", getCourseById);

courseRouter.patch(
  "/:courseId",
  requireRole("admin"),
  upload.single("thumbnail"),
  updateCourse,
);
courseRouter.delete("/:courseId", requireRole("admin"), deleteCourse);

// ─── Modules ──────────────────────────────────────────────
courseRouter.post("/:courseId/modules", requireRole("admin"), createModule);
courseRouter.get("/:courseId/modules", getModules);
courseRouter.patch(
  "/:courseId/modules/:moduleId",
  requireRole("admin"),
  updateModule,
);
courseRouter.delete(
  "/:courseId/modules/:moduleId",
  requireRole("admin"),
  deleteModule,
);

// ─── Materials ────────────────────────────────────────────
courseRouter.post(
  "/:courseId/modules/:moduleId/materials",
  requireRole("admin"),
  upload.array("files", 10), // up to 10 files at once
  uploadMaterials,
);
courseRouter.delete(
  "/:courseId/modules/:moduleId/materials/:materialId",
  requireRole("admin"),
  deleteMaterial,
);

export { courseRouter };
