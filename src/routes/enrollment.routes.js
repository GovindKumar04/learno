import express from "express";
import {
  checkMyEnrollment,
  enrollStudent,
  unenrollStudent,
  getMyCourses,
  getCourseStudents,
  getStudentEnrollments,
  getAllEnrollments,
  getUnenrolledStudents,
  broadcastEmail,
} from "../controllers/enrollment.controller.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";
import { requireRole } from "../middlewares/role.middleware.js";

const enrollmentRouter = express.Router();

enrollmentRouter.use(verifyJWT);

// Admin: all enrollments
enrollmentRouter.get("/", requireRole("admin"), getAllEnrollments);

// Admin: students with no active enrollment + bulk email them
enrollmentRouter.get("/unenrolled-students", requireRole("admin"), getUnenrolledStudents);
enrollmentRouter.post("/broadcast", requireRole("admin"), broadcastEmail);

// Student sees their own enrolled courses
enrollmentRouter.get("/my-courses", getMyCourses);

// Check if current user is enrolled in a course
enrollmentRouter.get("/check/:courseId", checkMyEnrollment);

// Admin enrolls a student
enrollmentRouter.post("/", requireRole("admin"), enrollStudent);

// Admin unenrolls a student
enrollmentRouter.delete("/:enrollmentId", requireRole("admin"), unenrollStudent);

// Admin/instructor sees all students in a course
enrollmentRouter.get("/course/:courseId/students", requireRole("admin", "instructor"), getCourseStudents);

// Admin sees all enrollments for a specific student
enrollmentRouter.get("/student/:userId", requireRole("admin"), getStudentEnrollments);

export { enrollmentRouter };
