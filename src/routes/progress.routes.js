import express from "express";
import {
  markMaterialWatched,
  getMyProgress,
  getCourseProgress,
  getStudentProgress,
  getPlatformProgressOverview,
} from "../controllers/progress.controller.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";
import { requireRole } from "../middlewares/role.middleware.js";

const progressRouter = express.Router();

progressRouter.use(verifyJWT);

// Student marks a material as watched
progressRouter.post("/mark-watched", markMaterialWatched);

// Student sees their own progress in a course
progressRouter.get("/my-progress/:courseId", getMyProgress);

// Admin / instructor sees all students' progress in a course
progressRouter.get("/course/:courseId", requireRole("admin", "instructor"), getCourseProgress);

// Admin sees all courses a specific student has progress in
progressRouter.get("/student/:userId", requireRole("admin"), getStudentProgress);

// Admin sees platform-wide progress overview
progressRouter.get("/overview", requireRole("admin"), getPlatformProgressOverview);

export { progressRouter };
