import { Enrollment } from "../models/enrollment.model.js";
import { Progress } from "../models/progress.model.js";
import { Course } from "../models/course.model.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { sendBroadcastMail } from "../utils/mail.util.js";
import { getOfflineAttendance } from "../utils/attendance.util.js";
import pool from "../config/db.js";

// ─────────────────────────────────────────────────────────────────────────────
// POST /enrollments
// Admin enrolls a student into a course
// Body: { userId, courseId }
// ─────────────────────────────────────────────────────────────────────────────
const checkMyEnrollment = asyncHandler(async (req, res) => {
  const { courseId } = req.params;
  const enrollment = await Enrollment.findOne({
    userId: req.user.id,
    courseId,
    isActive: true,
  }).select("enrollmentType");

  if (!enrollment) {
    return res.json(new ApiResponse(200, { isEnrolled: false, enrollmentType: null }));
  }
  return res.json(new ApiResponse(200, { isEnrolled: true, enrollmentType: enrollment.enrollmentType }));
});

const enrollStudent = asyncHandler(async (req, res) => {
  const { userId, courseId, enrollmentType = "online" } = req.body;

  if (!userId || !courseId) {
    throw new ApiError(400, "userId and courseId are required");
  }

  // Verify the user exists in PostgreSQL and is a student
  const userResult = await pool.query(
    "SELECT id, full_name, email, role FROM users WHERE id = $1",
    [userId]
  );
  if (userResult.rows.length === 0) throw new ApiError(404, "User not found");
  const user = userResult.rows[0];
  if (user.role !== "student") {
    throw new ApiError(400, "Only students can be enrolled in courses");
  }

  // Verify the course exists
  const course = await Course.findById(courseId);
  if (!course) throw new ApiError(404, "Course not found");

  // The course must actually be offered in the chosen mode
  if (Array.isArray(course.modes) && course.modes.length && !course.modes.includes(enrollmentType)) {
    throw new ApiError(400, `This course is not available ${enrollmentType}.`);
  }

  // Check for existing enrollment (active or inactive)
  const existing = await Enrollment.findOne({ userId, courseId });
  if (existing) {
    if (existing.isActive) {
      throw new ApiError(409, "Student is already enrolled in this course");
    }
    // Re-activate a previously unenrolled student
    existing.isActive = true;
    existing.unenrolledAt = null;
    existing.enrolledBy = req.user.id;
    existing.enrollmentType = enrollmentType;
    await existing.save();
    return res.status(200).json(
      new ApiResponse(200, existing, "Student re-enrolled successfully")
    );
  }

  const enrollment = await Enrollment.create({
    userId,
    courseId,
    enrolledBy: req.user.id,
    enrollmentType,
  });

  // Pre-create an empty progress document for this enrollment
  await Progress.create({ userId, courseId });

  return res
    .status(201)
    .json(new ApiResponse(201, enrollment, "Student enrolled successfully"));
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /enrollments/:enrollmentId
// Admin unenrolls a student (soft delete — keeps progress history)
// ─────────────────────────────────────────────────────────────────────────────
const unenrollStudent = asyncHandler(async (req, res) => {
  const enrollment = await Enrollment.findById(req.params.enrollmentId);
  if (!enrollment) throw new ApiError(404, "Enrollment not found");
  if (!enrollment.isActive) throw new ApiError(400, "Student is already unenrolled");

  enrollment.isActive = false;
  enrollment.unenrolledAt = new Date();
  await enrollment.save();

  return res.json(new ApiResponse(200, enrollment, "Student unenrolled successfully"));
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /enrollments/my-courses
// Student sees their own enrolled courses with progress
// ─────────────────────────────────────────────────────────────────────────────
const getMyCourses = asyncHandler(async (req, res) => {
  const enrollments = (await Enrollment.find({
    userId: req.user.id,
    isActive: true,
  }).populate({
    path: "courseId",
    select: "title description thumbnail category level price slug duration",
  }))
    // Drop enrollments whose course was deleted (populated courseId is null).
    .filter((e) => e.courseId);

  // Attach progress percentage to each enrollment
  const progressDocs = await Progress.find({
    userId: req.user.id,
    courseId: { $in: enrollments.map((e) => e.courseId._id) },
  }).select("courseId completionPercent lastAccessedAt");

  const progressMap = {};
  progressDocs.forEach((p) => {
    progressMap[p.courseId.toString()] = {
      completionPercent: p.completionPercent,
      lastAccessedAt: p.lastAccessedAt,
    };
  });

  const result = await Promise.all(
    enrollments.map(async (e) => {
      const progress = progressMap[e.courseId._id.toString()] || {
        completionPercent: 0,
        lastAccessedAt: null,
      };
      const base = {
        enrollmentId: e._id,
        enrolledAt: e.createdAt,
        enrollmentType: e.enrollmentType,
        course: e.courseId,
        progress,
      };

      // Offline courses are tracked by attendance, not online progress.
      if (e.enrollmentType === "offline") {
        const att = await getOfflineAttendance(e.userId, e.courseId._id);
        return {
          ...base,
          attendance: att
            ? { present: att.present, totalClasses: att.totalClasses, rate: att.rate, eligible: att.eligible, classesNeeded: att.classesNeeded }
            : null,
          completed: !!(att && att.eligible),
        };
      }

      return { ...base, completed: progress.completionPercent === 100 };
    })
  );

  return res.json(new ApiResponse(200, result));
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /enrollments/course/:courseId/students
// Admin or instructor sees all students enrolled in a course
// ─────────────────────────────────────────────────────────────────────────────
const getCourseStudents = asyncHandler(async (req, res) => {
  const { courseId } = req.params;
  const { page = 1, limit = 20 } = req.query;
  const pageNum = Number(page);
  const limitNum = Number(limit);

  const course = await Course.findById(courseId).select("title instructorId");
  if (!course) throw new ApiError(404, "Course not found");

  // Instructors can only view students for their own courses
  if (
    req.user.role === "instructor" &&
    course.instructorId !== req.user.id
  ) {
    throw new ApiError(403, "You can only view students in your own courses");
  }

  const [enrollments, total] = await Promise.all([
    Enrollment.find({ courseId, isActive: true })
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum)
      .sort({ createdAt: -1 }),
    Enrollment.countDocuments({ courseId, isActive: true }),
  ]);

  if (enrollments.length === 0) {
    return res.json(
      new ApiResponse(200, { students: [], total: 0, page: pageNum, limit: limitNum })
    );
  }

  // Fetch user details from PostgreSQL
  const userIds = enrollments.map((e) => e.userId);
  const placeholders = userIds.map((_, i) => `$${i + 1}`).join(", ");
  const usersResult = await pool.query(
    `SELECT id, full_name, email, roll_number, phone, avatar FROM users WHERE id IN (${placeholders})`,
    userIds
  );
  const usersMap = {};
  usersResult.rows.forEach((u) => (usersMap[u.id] = u));

  // Fetch progress for all these students in this course
  const progressDocs = await Progress.find({
    userId: { $in: userIds },
    courseId,
  }).select("userId completionPercent lastAccessedAt completedAt");
  const progressMap = {};
  progressDocs.forEach((p) => (progressMap[p.userId] = p));

  const students = enrollments.map((e) => ({
    enrollmentId: e._id,
    enrolledAt: e.createdAt,
    enrollmentType: e.enrollmentType,
    user: usersMap[e.userId] || { id: e.userId },
    progress: progressMap[e.userId] || {
      completionPercent: 0,
      lastAccessedAt: null,
      completedAt: null,
    },
  }));

  return res.json(
    new ApiResponse(200, { students, total, page: pageNum, limit: limitNum })
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /enrollments/student/:userId
// Admin sees all courses a specific student is enrolled in
// ─────────────────────────────────────────────────────────────────────────────
const getStudentEnrollments = asyncHandler(async (req, res) => {
  const { userId } = req.params;

  const enrollments = (await Enrollment.find({
    userId: userId,
    isActive: true,
  }).populate("courseId", "title thumbnail category level"))
    // Drop enrollments whose course was deleted (populated courseId is null).
    .filter((e) => e.courseId);

  const progressDocs = await Progress.find({
    userId: userId,
  }).select("courseId completionPercent lastAccessedAt completedAt");
  const progressMap = {};
  progressDocs.forEach((p) => (progressMap[p.courseId.toString()] = p));

  const result = enrollments.map((e) => ({
    enrollmentId: e._id,
    enrolledAt: e.createdAt,
    course: e.courseId,
    progress: progressMap[e.courseId._id.toString()] || {
      completionPercent: 0,
      lastAccessedAt: null,
    },
  }));

  return res.json(new ApiResponse(200, result));
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /enrollments  (admin only)
// Returns all active enrollments with user info and course title
// ─────────────────────────────────────────────────────────────────────────────
const getAllEnrollments = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, search = "" } = req.query;
  const pageNum = Number(page);
  const limitNum = Number(limit);

  const filter = { isActive: true };

  const [enrollments, total] = await Promise.all([
    Enrollment.find(filter)
      .populate("courseId", "title category level thumbnail")
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum)
      .sort({ createdAt: -1 }),
    Enrollment.countDocuments(filter),
  ]);

  if (enrollments.length === 0) {
    return res.json(new ApiResponse(200, { enrollments: [], total: 0, page: pageNum, limit: limitNum, totalPages: 0 }));
  }

  const userIds = enrollments.map((e) => e.userId);
  const placeholders = userIds.map((_, i) => `$${i + 1}`).join(", ");
  const usersResult = await pool.query(
    `SELECT id, full_name, email, roll_number, phone, avatar FROM users WHERE id IN (${placeholders})`,
    userIds
  );
  const usersMap = {};
  usersResult.rows.forEach((u) => (usersMap[u.id] = u));

  let data = enrollments.map((e) => ({
    id: e._id,
    enrolledAt: e.createdAt,
    enrollmentType: e.enrollmentType,
    user: usersMap[e.userId] || { id: e.userId },
    course: e.courseId,
  }));

  if (search) {
    // Every word must appear somewhere in the row (name/email/roll/course) — AND
    // match — so "govind kumar business analytics" matches across fields.
    const terms = search.toLowerCase().split(/\s+/).filter(Boolean);
    data = data.filter((d) => {
      const haystack = [
        d.user?.full_name,
        d.user?.email,
        d.user?.roll_number,
        d.course?.title,
        d.course?.category,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return terms.every((t) => haystack.includes(t));
    });
  }

  return res.json(
    new ApiResponse(200, {
      enrollments: data,
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum),
    })
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /enrollments/unenrolled-students  (admin only)
// Students (PostgreSQL) who have NO active enrollment in any course (Mongo).
// ─────────────────────────────────────────────────────────────────────────────
const getUnenrolledStudents = asyncHandler(async (req, res) => {
  const { search = "" } = req.query;

  // Distinct PG user ids that currently have an active enrollment
  const enrolledIds = await Enrollment.find({ isActive: true }).distinct("userId");
  const enrolledSet = new Set(enrolledIds.map(String));

  const conditions = ["role = 'student'"];
  const params = [];
  if (search) {
    params.push(`%${search}%`);
    conditions.push(
      `(full_name ILIKE $${params.length} OR email ILIKE $${params.length} OR roll_number ILIKE $${params.length})`
    );
  }

  const result = await pool.query(
    `SELECT id, full_name, email, roll_number, phone, location, avatar, created_at
       FROM users
      WHERE ${conditions.join(" AND ")}
      ORDER BY created_at DESC`,
    params
  );

  const students = result.rows.filter((u) => !enrolledSet.has(String(u.id)));

  return res.json(new ApiResponse(200, { students, total: students.length }));
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /enrollments/broadcast  (admin only)
// Bulk-email students. Body: { subject, message, userIds? }
//   - userIds given  → email those students
//   - userIds absent → email ALL students with no active enrollment
// ─────────────────────────────────────────────────────────────────────────────
const broadcastEmail = asyncHandler(async (req, res) => {
  const { subject, message, userIds } = req.body;

  if (!subject?.trim() || !message?.trim()) {
    throw new ApiError(400, "subject and message are required");
  }

  // Resolve the target id list
  let targetIds;
  if (Array.isArray(userIds) && userIds.length > 0) {
    targetIds = userIds;
  } else {
    const enrolledIds = await Enrollment.find({ isActive: true }).distinct("userId");
    const enrolledSet = new Set(enrolledIds.map(String));
    const all = await pool.query("SELECT id FROM users WHERE role = 'student'");
    targetIds = all.rows.map((r) => r.id).filter((id) => !enrolledSet.has(String(id)));
  }

  if (targetIds.length === 0) throw new ApiError(400, "No recipients to email");

  // Fetch emails — restricted to students, so a stray id can't target staff
  const placeholders = targetIds.map((_, i) => `$${i + 1}`).join(", ");
  const usersResult = await pool.query(
    `SELECT id, full_name, email FROM users WHERE role = 'student' AND id IN (${placeholders})`,
    targetIds
  );

  if (usersResult.rows.length === 0) throw new ApiError(404, "No matching students found");

  const subjectClean = subject.trim();
  const messageClean = message.trim();

  // Send in throttled batches so a large blast doesn't overwhelm the SMTP
  // server or trip provider rate limits (e.g. Gmail). Within a batch we send
  // in parallel; between batches we pause.
  const BATCH_SIZE = 20;
  const BATCH_DELAY_MS = 1000;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const recipients = usersResult.rows;
  let sent = 0;
  let failed = 0;

  for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
    const batch = recipients.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map((u) =>
        sendBroadcastMail({ name: u.full_name, email: u.email, subject: subjectClean, message: messageClean })
      )
    );
    sent += results.filter((r) => r.status === "fulfilled").length;
    failed += results.filter((r) => r.status === "rejected").length;

    // Pause before the next batch (not after the last one)
    if (i + BATCH_SIZE < recipients.length) await sleep(BATCH_DELAY_MS);
  }

  return res.json(
    new ApiResponse(
      200,
      { sent, failed, total: recipients.length },
      `Email sent to ${sent} student(s)${failed ? `, ${failed} failed` : ""}`
    )
  );
});

export {
  checkMyEnrollment,
  enrollStudent,
  unenrollStudent,
  getMyCourses,
  getCourseStudents,
  getStudentEnrollments,
  getAllEnrollments,
  getUnenrolledStudents,
  broadcastEmail,
};