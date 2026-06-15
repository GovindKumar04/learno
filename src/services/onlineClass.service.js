import { OnlineClass } from "../models/onlineClass.model.js";
import { Course } from "../models/course.model.js";
import { Enrollment } from "../models/enrollment.model.js";
import { TeachingRequest } from "../models/teachingRequest.model.js";
import { Attendance } from "../models/attendance.model.js";
import { ApiError } from "../utils/ApiError.js";
import { sendOnlineClassMail } from "../utils/mail.util.js";
import pool from "../config/db.js";

const VALID_STATUS = ["present", "absent", "leave"];

// "YYYY-MM-DD" for a Date (local), used as the attendance session date.
function ymd(date) {
  const d = new Date(date);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Fetch { id → user } map from PostgreSQL for a list of UUIDs
async function fetchUsersMap(ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return {};
  const placeholders = unique.map((_, i) => `$${i + 1}`).join(", ");
  const result = await pool.query(
    `SELECT id, full_name, email, phone, role FROM users WHERE id IN (${placeholders})`,
    unique,
  );
  const map = {};
  result.rows.forEach((u) => (map[u.id] = u));
  return map;
}

// Human-readable schedule string for the email.
function formatWhen(startTime, durationMins) {
  try {
    const d = new Date(startTime);
    const date = d.toLocaleString("en-IN", {
      weekday: "short", day: "numeric", month: "short", year: "numeric",
      hour: "numeric", minute: "2-digit", hour12: true,
    });
    return durationMins ? `${date} · ${durationMins} min` : date;
  } catch {
    return "";
  }
}

// Email the instructor + all live-enrolled students for the class's course.
async function notifyOnlineClass(onlineClass) {
  const course = await Course.findById(onlineClass.courseId).select("title");
  const liveEnrollments = await Enrollment.find({
    courseId: onlineClass.courseId,
    enrollmentType: "live",
    isActive: true,
  }).select("userId");

  const usersMap = await fetchUsersMap([
    onlineClass.instructorId,
    ...liveEnrollments.map((e) => e.userId),
  ]);
  const recipients = [
    usersMap[onlineClass.instructorId],
    ...liveEnrollments.map((e) => usersMap[e.userId]),
  ];

  const when = formatWhen(onlineClass.startTime, onlineClass.durationMins);

  await Promise.allSettled(
    recipients
      .filter((u) => u && u.email)
      .map((u) =>
        sendOnlineClassMail({
          name: u.full_name || "there",
          email: u.email,
          role: u.role,
          courseName: course?.title || "your course",
          title: onlineClass.title,
          joinUrl: onlineClass.joinUrl,
          meetingId: onlineClass.meetingId,
          passcode: onlineClass.passcode,
          when,
        }),
      ),
  );
}

// Instructor must hold an approved teaching request for the course.
async function validateInstructor(courseId, instructorId) {
  const course = await Course.findById(courseId).select("_id");
  if (!course) throw new ApiError(404, "Course not found");

  const approved = await TeachingRequest.findOne({ courseId, instructorId, status: "approved" });
  if (!approved) throw new ApiError(400, "Instructor must have an approved teaching request for this course");
}

// Map a stored doc + a users map into the API shape.
function shapeClass(c, usersMap) {
  return {
    id: c._id,
    title: c.title,
    course: c.courseId,
    instructor: usersMap[c.instructorId] || { id: c.instructorId },
    joinUrl: c.joinUrl,
    meetingId: c.meetingId,
    passcode: c.passcode,
    startTime: c.startTime,
    durationMins: c.durationMins,
    status: c.status,
    createdAt: c.createdAt,
  };
}

// GET /online-classes/course/:courseId/options  (admin) — approved instructors
export const getOnlineClassOptionsService = async (courseId) => {
  const course = await Course.findById(courseId).select("title");
  if (!course) throw new ApiError(404, "Course not found");

  const approvedReqs = await TeachingRequest.find({ courseId, status: "approved" }).select("instructorId");
  const usersMap = await fetchUsersMap(approvedReqs.map((r) => r.instructorId));

  const instructors = approvedReqs
    .map((r) => usersMap[r.instructorId])
    .filter(Boolean)
    .map((u) => ({ id: u.id, full_name: u.full_name, email: u.email }));

  return { course: { id: course._id, title: course.title }, instructors };
};

export const createOnlineClassService = async ({ body, createdBy }) => {
  const {
    title, courseId, instructorId, joinUrl,
    meetingId = "", passcode = "", startTime, durationMins = 60, status = "scheduled",
  } = body;

  if (!title || !courseId || !instructorId || !joinUrl || !startTime) {
    throw new ApiError(400, "title, courseId, instructorId, joinUrl, and startTime are required");
  }

  await validateInstructor(courseId, instructorId);

  const onlineClass = await OnlineClass.create({
    title, courseId, instructorId, joinUrl, meetingId, passcode, startTime, durationMins, status, createdBy,
  });
  await notifyOnlineClass(onlineClass);
  return onlineClass;
};

// GET /online-classes  (admin) — all classes, newest scheduled first
export const getAllOnlineClassesService = async () => {
  const classes = await OnlineClass.find({})
    .populate("courseId", "title category")
    .sort({ startTime: -1 });
  const usersMap = await fetchUsersMap(classes.map((c) => c.instructorId));
  return classes.map((c) => shapeClass(c, usersMap));
};

// Compact course shape used by the "Classes" filter sub-nav.
const shapeCourse = (c) => ({ id: c._id, title: c.title, thumbnail: c.thumbnail, slug: c.slug });

// GET /online-classes/instructor  (instructor) — classes they teach + the courses
// they're approved to teach live (so a course shows in the filter even with no
// sessions scheduled yet). Returns { courses, classes }.
export const getInstructorOnlineClassesService = async (instructorId) => {
  const classes = await OnlineClass.find({ instructorId })
    .populate("courseId", "title category thumbnail slug")
    .sort({ startTime: 1 });
  const usersMap = await fetchUsersMap([instructorId]);

  const approved = await TeachingRequest.find({ instructorId, status: "approved" })
    .populate("courseId", "title thumbnail slug modes");

  const courseMap = new Map();
  approved.forEach((r) => {
    const c = r.courseId;
    if (c && c.modes?.includes("live")) courseMap.set(c._id.toString(), shapeCourse(c));
  });
  // Always include courses that already have an assigned class (in case modes changed).
  classes.forEach((c) => {
    const course = c.courseId;
    if (course && !courseMap.has(course._id.toString())) courseMap.set(course._id.toString(), shapeCourse(course));
  });

  return { courses: [...courseMap.values()], classes: classes.map((c) => shapeClass(c, usersMap)) };
};

// GET /online-classes/student  (student) — live classes for the courses they're
// live-enrolled in, plus those courses themselves (so a course shows in the
// filter even before any session is scheduled). Returns { courses, classes }.
export const getStudentOnlineClassesService = async (userId) => {
  const liveEnrollments = await Enrollment.find({
    userId,
    enrollmentType: "live",
    isActive: true,
  }).populate("courseId", "title category thumbnail slug");

  const courses = liveEnrollments.filter((e) => e.courseId).map((e) => shapeCourse(e.courseId));
  const courseIds = courses.map((c) => c.id);
  if (courseIds.length === 0) return { courses: [], classes: [] };

  const classes = await OnlineClass.find({
    courseId: { $in: courseIds },
    status: { $ne: "cancelled" },
  })
    .populate("courseId", "title category thumbnail slug")
    .sort({ startTime: 1 });

  const usersMap = await fetchUsersMap(classes.map((c) => c.instructorId));
  return { courses, classes: classes.map((c) => shapeClass(c, usersMap)) };
};

export const updateOnlineClassService = async ({ id, body }) => {
  const onlineClass = await OnlineClass.findById(id);
  if (!onlineClass) throw new ApiError(404, "Online class not found");

  const { title, instructorId, joinUrl, meetingId, passcode, startTime, durationMins, status } = body;
  const courseId = onlineClass.courseId; // course is fixed once created

  if (instructorId !== undefined && instructorId !== onlineClass.instructorId) {
    await validateInstructor(courseId, instructorId);
  }

  // Re-notify when the time, link, or instructor changes (not on a status-only flip).
  const shouldNotify =
    instructorId !== undefined || joinUrl !== undefined ||
    startTime !== undefined || meetingId !== undefined || passcode !== undefined;

  if (title !== undefined) onlineClass.title = title;
  if (instructorId !== undefined) onlineClass.instructorId = instructorId;
  if (joinUrl !== undefined) onlineClass.joinUrl = joinUrl;
  if (meetingId !== undefined) onlineClass.meetingId = meetingId;
  if (passcode !== undefined) onlineClass.passcode = passcode;
  if (startTime !== undefined) onlineClass.startTime = startTime;
  if (durationMins !== undefined) onlineClass.durationMins = durationMins;
  if (status !== undefined) onlineClass.status = status;

  await onlineClass.save();
  if (shouldNotify) await notifyOnlineClass(onlineClass);
  return onlineClass;
};

export const deleteOnlineClassService = async (id) => {
  const onlineClass = await OnlineClass.findByIdAndDelete(id);
  if (!onlineClass) throw new ApiError(404, "Online class not found");
  // Remove the attendance record tied to this live session, if any.
  await Attendance.deleteOne({ onlineClassId: id });
};

// ─── Live-class attendance ───────────────────────────────────
// Load a live class and ensure the caller may manage it (assigned instructor or admin).
async function loadOnlineClassAuthorized(id, user) {
  const onlineClass = await OnlineClass.findById(id).populate("courseId", "title");
  if (!onlineClass) throw new ApiError(404, "Online class not found");
  if (user.role !== "admin" && onlineClass.instructorId !== user.id) {
    throw new ApiError(403, "You are not assigned to this live class");
  }
  return onlineClass;
}

// GET /online-classes/:id/attendance (instructor/admin) — roster + any saved marks
export const getLiveClassAttendanceService = async ({ id, user }) => {
  const onlineClass = await loadOnlineClassAuthorized(id, user);
  const courseId = onlineClass.courseId?._id || onlineClass.courseId;

  const enrollments = await Enrollment.find({
    courseId,
    enrollmentType: "live",
    isActive: true,
  }).select("userId");

  const usersMap = await fetchUsersMap(enrollments.map((e) => e.userId));

  const session = await Attendance.findOne({ onlineClassId: id }).select("records");
  const statusMap = {};
  (session?.records || []).forEach((r) => (statusMap[String(r.studentId)] = r.status));

  const roster = enrollments.map((e) => ({
    studentId: e.userId,
    full_name: usersMap[e.userId]?.full_name || null,
    email: usersMap[e.userId]?.email || null,
    status: statusMap[String(e.userId)] || "present",
  }));

  return {
    onlineClass: {
      id: onlineClass._id,
      title: onlineClass.title,
      startTime: onlineClass.startTime,
      course: onlineClass.courseId,
    },
    roster,
    marked: !!session,
  };
};

// POST /online-classes/:id/attendance (instructor/admin) — upsert marks
export const markLiveClassAttendanceService = async ({ id, records, user }) => {
  if (!Array.isArray(records) || records.length === 0) {
    throw new ApiError(400, "records must be a non-empty array");
  }

  const onlineClass = await loadOnlineClassAuthorized(id, user);
  const courseId = onlineClass.courseId?._id || onlineClass.courseId;

  const enrollments = await Enrollment.find({
    courseId,
    enrollmentType: "live",
    isActive: true,
  }).select("userId");
  const roster = new Set(enrollments.map((e) => String(e.userId)));

  const clean = records.map((r) => {
    const studentId = String(r.studentId || "");
    const status = String(r.status || "").toLowerCase();
    if (!roster.has(studentId)) throw new ApiError(400, `Student ${studentId} is not enrolled live in this course`);
    if (!VALID_STATUS.includes(status)) {
      throw new ApiError(400, `Invalid status "${r.status}" (use present, absent or leave)`);
    }
    return { studentId, status };
  });

  return Attendance.findOneAndUpdate(
    { onlineClassId: id },
    { $set: { courseId, date: ymd(onlineClass.startTime), records: clean, markedBy: user.id } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
};
