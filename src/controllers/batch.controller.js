import { Batch } from "../models/batch.model.js";
import { Course } from "../models/course.model.js";
import { Enrollment } from "../models/enrollment.model.js";
import { TeachingRequest } from "../models/teachingRequest.model.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { sendBatchAssignmentMail } from "../utils/mail.util.js";
import pool from "../config/db.js";

// Fetch { id → user } map from PostgreSQL for a list of UUIDs
async function fetchUsersMap(ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return {};
  const placeholders = unique.map((_, i) => `$${i + 1}`).join(", ");
  const result = await pool.query(
    `SELECT id, full_name, email, phone, role FROM users WHERE id IN (${placeholders})`,
    unique
  );
  const map = {};
  result.rows.forEach((u) => (map[u.id] = u));
  return map;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /batches/course/:courseId/options   (admin)
// Returns the instructors + students assignable to a batch of this course:
//   - instructors with an APPROVED teaching request for the course
//   - students offline-enrolled (active) in the course
// ─────────────────────────────────────────────────────────────────────────────
const getBatchOptions = asyncHandler(async (req, res) => {
  const { courseId } = req.params;

  const course = await Course.findById(courseId).select("title");
  if (!course) throw new ApiError(404, "Course not found");

  const [approvedReqs, offlineEnrollments] = await Promise.all([
    TeachingRequest.find({ courseId, status: "approved" }).select("instructorId"),
    Enrollment.find({ courseId, enrollmentType: "offline", isActive: true }).select("userId"),
  ]);

  const usersMap = await fetchUsersMap([
    ...approvedReqs.map((r) => r.instructorId),
    ...offlineEnrollments.map((e) => e.userId),
  ]);

  const instructors = approvedReqs
    .map((r) => usersMap[r.instructorId])
    .filter(Boolean)
    .map((u) => ({ id: u.id, full_name: u.full_name, email: u.email }));

  const students = offlineEnrollments
    .map((e) => usersMap[e.userId])
    .filter(Boolean)
    .map((u) => ({ id: u.id, full_name: u.full_name, email: u.email }));

  return res.json(new ApiResponse(200, { course: { id: course._id, title: course.title }, instructors, students }));
});

// Email the time + location to the assigned instructor and students.
// Fire-and-forget: failures are logged inside the mail util, never block the request.
async function notifyBatchAssignment(batch) {
  const course = await Course.findById(batch.courseId).select("title");
  const usersMap = await fetchUsersMap([batch.instructorId, ...(batch.studentIds || [])]);

  const recipients = [usersMap[batch.instructorId], ...(batch.studentIds || []).map((id) => usersMap[id])];

  await Promise.allSettled(
    recipients
      .filter((u) => u && u.email)
      .map((u) =>
        sendBatchAssignmentMail({
          name: u.full_name || "there",
          email: u.email,
          role: u.role,
          courseName: course?.title || "your course",
          batchName: batch.name,
          schedule: batch.schedule,
          location: batch.location,
        })
      )
  );
}

// Shared validation for create/update: instructor approved + students offline-enrolled
async function validateAssignment(courseId, instructorId, studentIds = []) {
  const course = await Course.findById(courseId).select("_id");
  if (!course) throw new ApiError(404, "Course not found");

  const approved = await TeachingRequest.findOne({
    courseId,
    instructorId,
    status: "approved",
  });
  if (!approved) {
    throw new ApiError(400, "Instructor must have an approved teaching request for this course");
  }

  if (studentIds.length > 0) {
    const validCount = await Enrollment.countDocuments({
      courseId,
      userId: { $in: studentIds },
      enrollmentType: "offline",
      isActive: true,
    });
    if (validCount !== studentIds.length) {
      throw new ApiError(400, "All students must be offline-enrolled in this course");
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /batches   (admin)
// ─────────────────────────────────────────────────────────────────────────────
const createBatch = asyncHandler(async (req, res) => {
  const { name, courseId, instructorId, studentIds = [], schedule = "", location = "", seats = 0, status = "upcoming" } = req.body;

  if (!name || !courseId || !instructorId) {
    throw new ApiError(400, "name, courseId, and instructorId are required");
  }

  await validateAssignment(courseId, instructorId, studentIds);

  const batch = await Batch.create({
    name,
    courseId,
    instructorId,
    studentIds,
    schedule,
    location,
    seats,
    status,
    createdBy: req.user.id,
  });

  // Notify instructor + students of the time & location
  await notifyBatchAssignment(batch);

  return res.status(201).json(new ApiResponse(201, batch, "Batch created successfully"));
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /batches   (admin) — all batches with course + instructor + student details
// ─────────────────────────────────────────────────────────────────────────────
const getAllBatches = asyncHandler(async (req, res) => {
  const batches = await Batch.find({})
    .populate("courseId", "title category")
    .sort({ createdAt: -1 });

  const usersMap = await fetchUsersMap(
    batches.flatMap((b) => [b.instructorId, ...(b.studentIds || [])])
  );

  const data = batches.map((b) => ({
    id: b._id,
    name: b.name,
    course: b.courseId,
    instructor: usersMap[b.instructorId] || { id: b.instructorId },
    students: (b.studentIds || []).map((id) => usersMap[id] || { id }),
    studentCount: (b.studentIds || []).length,
    schedule: b.schedule,
    location: b.location,
    mode: b.mode,
    seats: b.seats,
    status: b.status,
    createdAt: b.createdAt,
  }));

  return res.json(new ApiResponse(200, data));
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /batches/my   (instructor) — batches assigned to the current instructor
// ─────────────────────────────────────────────────────────────────────────────
const getMyBatches = asyncHandler(async (req, res) => {
  const batches = await Batch.find({ instructorId: req.user.id })
    .populate("courseId", "title category thumbnail slug")
    .sort({ createdAt: -1 });

  const usersMap = await fetchUsersMap(batches.flatMap((b) => b.studentIds || []));

  const data = batches.map((b) => ({
    id: b._id,
    name: b.name,
    course: b.courseId,
    students: (b.studentIds || []).map((id) => usersMap[id] || { id }),
    studentCount: (b.studentIds || []).length,
    schedule: b.schedule,
    location: b.location,
    mode: b.mode,
    seats: b.seats,
    status: b.status,
  }));

  return res.json(new ApiResponse(200, data));
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /batches/:id   (admin)
// ─────────────────────────────────────────────────────────────────────────────
const updateBatch = asyncHandler(async (req, res) => {
  const batch = await Batch.findById(req.params.id);
  if (!batch) throw new ApiError(404, "Batch not found");

  const { name, instructorId, studentIds, schedule, location, seats, status } = req.body;
  const courseId = batch.courseId; // course is fixed once created

  // Re-validate if instructor or roster changes
  if (instructorId !== undefined || studentIds !== undefined) {
    await validateAssignment(
      courseId,
      instructorId ?? batch.instructorId,
      studentIds ?? batch.studentIds
    );
  }

  // Re-notify when the assignment, time, or location changes
  const shouldNotify =
    instructorId !== undefined ||
    studentIds !== undefined ||
    schedule !== undefined ||
    location !== undefined;

  if (name !== undefined)         batch.name = name;
  if (instructorId !== undefined) batch.instructorId = instructorId;
  if (studentIds !== undefined)   batch.studentIds = studentIds;
  if (schedule !== undefined)     batch.schedule = schedule;
  if (location !== undefined)     batch.location = location;
  if (seats !== undefined)        batch.seats = seats;
  if (status !== undefined)       batch.status = status;

  await batch.save();

  if (shouldNotify) await notifyBatchAssignment(batch);

  return res.json(new ApiResponse(200, batch, "Batch updated successfully"));
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /batches/:id   (admin)
// ─────────────────────────────────────────────────────────────────────────────
const deleteBatch = asyncHandler(async (req, res) => {
  const batch = await Batch.findByIdAndDelete(req.params.id);
  if (!batch) throw new ApiError(404, "Batch not found");
  return res.json(new ApiResponse(200, null, "Batch deleted successfully"));
});

export {
  getBatchOptions,
  createBatch,
  getAllBatches,
  getMyBatches,
  updateBatch,
  deleteBatch,
};
