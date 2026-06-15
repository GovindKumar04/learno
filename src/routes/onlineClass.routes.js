import express from "express";
import {
  getOnlineClassOptions,
  createOnlineClass,
  getAllOnlineClasses,
  getInstructorOnlineClasses,
  getStudentOnlineClasses,
  updateOnlineClass,
  deleteOnlineClass,
  getLiveClassAttendance,
  markLiveClassAttendance,
} from "../controllers/onlineClass.controller.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";
import { requireRole } from "../middlewares/role.middleware.js";

const onlineClassRouter = express.Router();

onlineClassRouter.use(verifyJWT);

// Student — live classes for the courses they're live-enrolled in
onlineClassRouter.get("/student", requireRole("student"), getStudentOnlineClasses);

// Instructor — classes they're assigned to teach
onlineClassRouter.get("/instructor", requireRole("instructor"), getInstructorOnlineClasses);

// Live-class attendance — assigned instructor or admin
onlineClassRouter.get("/:id/attendance", requireRole("instructor", "admin"), getLiveClassAttendance);
onlineClassRouter.post("/:id/attendance", requireRole("instructor", "admin"), markLiveClassAttendance);

// Admin — assignable instructors for a course
onlineClassRouter.get("/course/:courseId/options", requireRole("admin"), getOnlineClassOptions);

// Admin — class management
onlineClassRouter.get("/", requireRole("admin"), getAllOnlineClasses);
onlineClassRouter.post("/", requireRole("admin"), createOnlineClass);
onlineClassRouter.patch("/:id", requireRole("admin"), updateOnlineClass);
onlineClassRouter.delete("/:id", requireRole("admin"), deleteOnlineClass);

export { onlineClassRouter };
