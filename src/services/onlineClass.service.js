import { OnlineClass } from "../models/onlineClass.model.js";
import { Course } from "../models/course.model.js";
import { Enrollment } from "../models/enrollment.model.js";
import { TeachingRequest } from "../models/teachingRequest.model.js";
import { Attendance } from "../models/attendance.model.js";
import { Batch } from "../models/batch.model.js";
import { ApiError } from "../utils/ApiError.js";
import { sendOnlineClassMail } from "../utils/mail.util.js";
import pool from "../config/db.js";

const VALID_STATUS = ["present", "absent", "leave"];

// The student user-ids a live class is for: its batch's students when batch-scoped,
// otherwise every live-enrolled student of the course.
async function liveAudienceUserIds(onlineClass) {
  if (onlineClass.batchId) {
    const batch = await Batch.findById(onlineClass.batchId).select("studentIds");
    return (batch?.studentIds || []).map(String);
  }
  const courseId = onlineClass.courseId?._id || onlineClass.courseId;
  const enrollments = await Enrollment.find({
    courseId,
    enrollmentType: "live",
    isActive: true,
  }).select("userId");
  return enrollments.map((e) => String(e.userId));
}

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

// Email the instructor + the class's student audience (batch or course-wide).
async function notifyOnlineClass(onlineClass) {
  const course = await Course.findById(onlineClass.courseId).select("title");
  const audienceIds = await liveAudienceUserIds(onlineClass);

  const usersMap = await fetchUsersMap([onlineClass.instructorId, ...audienceIds]);
  const recipients = [usersMap[onlineClass.instructorId], ...audienceIds.map((id) => usersMap[id])];

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

// Map a stored doc + a users map into the API shape. `batch` is the populated
// batch doc when available (admin list), else just the stored batchId.
function shapeClass(c, usersMap) {
  const batch = c.batchId && typeof c.batchId === "object" && c.batchId.name
    ? { id: c.batchId._id, name: c.batchId.name }
    : c.batchId
      ? { id: c.batchId }
      : null;
  return {
    id: c._id,
    title: c.title,
    course: c.courseId,
    batch,
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

// Validate an optional live batch belongs to the course and is a live batch.
async function validateLiveBatch(batchId, courseId) {
  if (!batchId) return;
  const batch = await Batch.findById(batchId).select("courseId mode");
  if (!batch) throw new ApiError(404, "Batch not found");
  if (String(batch.courseId) !== String(courseId)) throw new ApiError(400, "Batch does not belong to this course");
  if (batch.mode !== "live") throw new ApiError(400, "Only LIVE batches can be assigned to a live class");
}

// GET /online-classes/course/:courseId/options  (admin) — approved instructors + live batches
export const getOnlineClassOptionsService = async (courseId) => {
  const course = await Course.findById(courseId).select("title");
  if (!course) throw new ApiError(404, "Course not found");

  const [approvedReqs, liveBatches] = await Promise.all([
    TeachingRequest.find({ courseId, status: "approved" }).select("instructorId"),
    Batch.find({ courseId, mode: "live" }).select("name instructorId studentIds"),
  ]);
  const usersMap = await fetchUsersMap(approvedReqs.map((r) => r.instructorId));

  const instructors = approvedReqs
    .map((r) => usersMap[r.instructorId])
    .filter(Boolean)
    .map((u) => ({ id: u.id, full_name: u.full_name, email: u.email }));

  const batches = liveBatches.map((b) => ({
    id: b._id,
    name: b.name,
    instructorId: b.instructorId,
    studentCount: (b.studentIds || []).length,
  }));

  return { course: { id: course._id, title: course.title }, instructors, batches };
};

export const createOnlineClassService = async ({ body, createdBy }) => {
  const {
    title, courseId, instructorId, joinUrl, batchId = null,
    meetingId = "", passcode = "", startTime, durationMins = 60, status = "scheduled",
  } = body;

  if (!title || !courseId || !instructorId || !joinUrl || !startTime) {
    throw new ApiError(400, "title, courseId, instructorId, joinUrl, and startTime are required");
  }

  await validateInstructor(courseId, instructorId);
  await validateLiveBatch(batchId, courseId);

  const onlineClass = await OnlineClass.create({
    title, courseId, instructorId, joinUrl, batchId: batchId || null,
    meetingId, passcode, startTime, durationMins, status, createdBy,
  });
  await notifyOnlineClass(onlineClass);
  return onlineClass;
};

// GET /online-classes  (admin) — all classes, newest scheduled first
export const getAllOnlineClassesService = async () => {
  const classes = await OnlineClass.find({})
    .populate("courseId", "title category")
    .populate("batchId", "name")
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
    .populate("batchId", "name")
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

  const allClasses = await OnlineClass.find({
    courseId: { $in: courseIds },
    status: { $ne: "cancelled" },
  })
    .populate("courseId", "title category thumbnail slug")
    .populate("batchId", "name")
    .sort({ startTime: 1 });

  // Batch-scoped classes are only visible to that batch's students; course-wide
  // classes (no batch) are visible to every live enrollee of the course.
  const myBatches = await Batch.find({ mode: "live", studentIds: userId }).select("_id");
  const myBatchIds = new Set(myBatches.map((b) => String(b._id)));
  const classes = allClasses.filter((c) => !c.batchId || myBatchIds.has(String(c.batchId?._id || c.batchId)));

  const usersMap = await fetchUsersMap(classes.map((c) => c.instructorId));
  return { courses, classes: classes.map((c) => shapeClass(c, usersMap)) };
};

export const updateOnlineClassService = async ({ id, body }) => {
  const onlineClass = await OnlineClass.findById(id);
  if (!onlineClass) throw new ApiError(404, "Online class not found");

  const { title, instructorId, joinUrl, meetingId, passcode, startTime, durationMins, status, batchId } = body;
  const courseId = onlineClass.courseId; // course is fixed once created

  if (instructorId !== undefined && instructorId !== onlineClass.instructorId) {
    await validateInstructor(courseId, instructorId);
  }
  if (batchId !== undefined && batchId) {
    await validateLiveBatch(batchId, courseId);
  }

  // Re-notify when the time, link, instructor, or batch changes (not on a status-only flip).
  const shouldNotify =
    instructorId !== undefined || joinUrl !== undefined || batchId !== undefined ||
    startTime !== undefined || meetingId !== undefined || passcode !== undefined;

  if (title !== undefined) onlineClass.title = title;
  if (batchId !== undefined) onlineClass.batchId = batchId || null;
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

  const audienceIds = await liveAudienceUserIds(onlineClass);
  const usersMap = await fetchUsersMap(audienceIds);

  const session = await Attendance.findOne({ onlineClassId: id }).select("records");
  const statusMap = {};
  (session?.records || []).forEach((r) => (statusMap[String(r.studentId)] = r.status));

  const roster = audienceIds.map((uid) => ({
    studentId: uid,
    full_name: usersMap[uid]?.full_name || null,
    email: usersMap[uid]?.email || null,
    status: statusMap[String(uid)] || "present",
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

  const roster = new Set(await liveAudienceUserIds(onlineClass));

  const clean = records.map((r) => {
    const studentId = String(r.studentId || "");
    const status = String(r.status || "").toLowerCase();
    if (!roster.has(studentId)) throw new ApiError(400, `Student ${studentId} is not in this class's audience`);
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
