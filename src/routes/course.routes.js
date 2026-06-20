import express from "express";
import {
  createCourse,
  getAllCourses,
  getCourseCategories,
  getCourseById,
  getCourseBySlug,
  updateCourse,
  deleteCourse,
  getTrending,
  getTopRated,
  getRecommended,
  getBecauseYouViewed,
  recordCourseView,
  logSearch,
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
  streamMaterialFile,
} from "../controllers/material.controller.js";
import {
  addOrUpdateReview,
  deleteReview,
  getReviews,
  getTestimonials,
  toggleFeatured,
  moderateReview,
  getPendingReviews,
} from "../controllers/review.controller.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";
import { optionalAuth } from "../middlewares/optionalAuth.middleware.js";
import { requireRole } from "../middlewares/role.middleware.js";
import { upload } from "../middlewares/multer.middleware.js";

const courseRouter = express.Router();

// ─── Courses ──────────────────────────────────────────────
courseRouter.post(
  "/",
  verifyJWT, requireRole("admin"),
  upload.single("thumbnail"),
  createCourse,
);
courseRouter.get("/", optionalAuth, getAllCourses);
courseRouter.get("/categories", optionalAuth, getCourseCategories);  // distinct categories

// ─── Home-page discovery ──────────────────────────────────────
// Declared BEFORE the "/:courseId" catch-all so these literal paths aren't
// swallowed as a course id.
courseRouter.get("/trending", optionalAuth, getTrending);
courseRouter.get("/top-rated", optionalAuth, getTopRated);
courseRouter.get("/recommended", optionalAuth, getRecommended);
courseRouter.get("/because-you-viewed", optionalAuth, getBecauseYouViewed);
courseRouter.post("/search-log", optionalAuth, logSearch);

// Admin review-moderation queue — literal path, must precede "/:courseId".
courseRouter.get("/reviews/pending", verifyJWT, requireRole("admin"), getPendingReviews);

courseRouter.get("/slug/:slug", optionalAuth, getCourseBySlug);  // by URL slug
courseRouter.get("/:courseId", optionalAuth, getCourseById);
courseRouter.post("/:courseId/view", optionalAuth, recordCourseView);

courseRouter.patch(
  "/:courseId",
  verifyJWT, requireRole("admin"),
  upload.single("thumbnail"),
  updateCourse,
);
courseRouter.delete("/:courseId", verifyJWT, requireRole("admin"), deleteCourse);

// ─── Modules ──────────────────────────────────────────────
courseRouter.post("/:courseId/modules", verifyJWT, requireRole("admin"), createModule);
courseRouter.get("/:courseId/modules", optionalAuth, getModules);
courseRouter.patch("/:courseId/modules/:moduleId", verifyJWT, requireRole("admin"), updateModule);
courseRouter.delete("/:courseId/modules/:moduleId", verifyJWT, requireRole("admin"), deleteModule);

// ─── Materials ────────────────────────────────────────────
courseRouter.post(
  "/:courseId/modules/:moduleId/materials",
  verifyJWT, requireRole("admin"),
  upload.array("files", 10),
  uploadMaterials,
);
courseRouter.delete(
  "/:courseId/modules/:moduleId/materials/:materialId",
  verifyJWT, requireRole("admin"),
  deleteMaterial,
);

// Authenticated streaming proxy for material files (PDFs) — access-checked inside.
courseRouter.get("/:courseId/materials/:materialId/file", optionalAuth, streamMaterialFile);

// ─── Reviews & Testimonials ───────────────────────────────
courseRouter.get("/:courseId/reviews", optionalAuth, getReviews);
courseRouter.get("/:courseId/reviews/testimonials", optionalAuth, getTestimonials);
courseRouter.post("/:courseId/reviews", verifyJWT, requireRole("student"), addOrUpdateReview);
courseRouter.delete("/:courseId/reviews", verifyJWT, deleteReview);
courseRouter.patch("/:courseId/reviews/featured", verifyJWT, requireRole("admin"), toggleFeatured);
courseRouter.patch("/:courseId/reviews/moderate", verifyJWT, requireRole("admin"), moderateReview);

export { courseRouter };
