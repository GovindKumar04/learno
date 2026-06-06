import express from "express";
import {
  markAttendance,
  getAttendance,
  getBatchAttendance,
  getMyAttendance,
} from "../controllers/attendance.controller.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";
import { requireRole } from "../middlewares/role.middleware.js";

const attendanceRouter = express.Router();

attendanceRouter.use(verifyJWT);

// Student: their own attendance summary for an offline course
attendanceRouter.get("/my/:courseId", requireRole("student"), getMyAttendance);

// Instructor (own batch) or admin
attendanceRouter.post("/", requireRole("instructor", "admin"), markAttendance);
attendanceRouter.get("/", requireRole("instructor", "admin"), getAttendance);
attendanceRouter.get("/batch/:batchId", requireRole("instructor", "admin"), getBatchAttendance);

export { attendanceRouter };
