import { Attendance } from "../models/attendance.model.js";
import { Batch } from "../models/batch.model.js";
import { Course } from "../models/course.model.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { getOfflineAttendance } from "../utils/attendance.util.js";
import { OFFLINE_ATTENDANCE_THRESHOLD } from "../config/constants.js";
import pool from "../config/db.js";

const VALID_STATUS = ["present", "absent", "leave"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Fetch { id → {full_name,email} } from PostgreSQL for a list of UUIDs
async function fetchUsersMap(ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return {};
  const placeholders = unique.map((_, i) => `$${i + 1}`).join(", ");
  const result = await pool.query(
    `SELECT id, full_name, email, phone FROM users WHERE id IN (${placeholders})`,
    unique,
  );
  const map = {};
  result.rows.forEach((u) => (map[u.id] = u));
  return map;
}

// Load a batch and ensure the caller may manage it (assigned instructor or admin)
async function loadBatchAuthorized(batchId, user) {
  const batch = await Batch.findById(batchId).populate("courseId", "title");
  if (!batch) throw new ApiError(404, "Batch not found");
  if (user.role !== "admin" && batch.instructorId !== user.id) {
    throw new ApiError(403, "You are not assigned to this batch");
  }
  return batch;
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /attendance   (instructor who owns the batch, or admin)
// Upsert one session: { batchId, date, records: [{ studentId, status }] }
// ─────────────────────────────────────────────────────────────────────────────
const markAttendance = asyncHandler(async (req, res) => {
  const { batchId, date, records } = req.body;

  if (!batchId || !date) throw new ApiError(400, "batchId and date are required");
  if (!DATE_RE.test(date)) throw new ApiError(400, "date must be in YYYY-MM-DD format");
  if (!Array.isArray(records) || records.length === 0) {
    throw new ApiError(400, "records must be a non-empty array");
  }

  const batch = await loadBatchAuthorized(batchId, req.user);
  const roster = new Set((batch.studentIds || []).map(String));

  // Don't let a batch exceed its course's planned number of classes. Editing an
  // already-recorded date is always allowed (so mistakes can be fixed); only
  // *new* sessions beyond the limit are blocked.
  const courseId = batch.courseId?._id || batch.courseId;
  const course = await Course.findById(courseId).select("totalClasses");
  const totalClasses = course?.totalClasses || 0;
  if (totalClasses > 0) {
    const existing = await Attendance.findOne({ batchId, date }).select("_id");
    if (!existing) {
      const sessionsHeld = await Attendance.countDocuments({ batchId });
      if (sessionsHeld >= totalClasses) {
        throw new ApiError(
          400,
          `All ${totalClasses} classes for this course have already been recorded. You can't mark attendance for a new date.`,
        );
      }
    }
  }

  const clean = records.map((r) => {
    const studentId = String(r.studentId || "");
    const status = String(r.status || "").toLowerCase();
    if (!roster.has(studentId)) {
      throw new ApiError(400, `Student ${studentId} is not in this batch`);
    }
    if (!VALID_STATUS.includes(status)) {
      throw new ApiError(400, `Invalid status "${r.status}" (use present, absent or leave)`);
    }
    return { studentId, status };
  });

  const session = await Attendance.findOneAndUpdate(
    { batchId, date },
    {
      $set: {
        courseId: batch.courseId?._id || batch.courseId,
        records: clean,
        markedBy: req.user.id,
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );

  return res.status(200).json(new ApiResponse(200, session, "Attendance saved"));
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /attendance?batchId=&date=   (instructor owner / admin)
// One session's records, enriched with student names (null if not marked yet)
// ─────────────────────────────────────────────────────────────────────────────
const getAttendance = asyncHandler(async (req, res) => {
  const { batchId, date } = req.query;
  if (!batchId || !date) throw new ApiError(400, "batchId and date are required");

  await loadBatchAuthorized(batchId, req.user);

  const session = await Attendance.findOne({ batchId, date });
  if (!session) return res.json(new ApiResponse(200, null, "No attendance marked for this date"));

  const usersMap = await fetchUsersMap(session.records.map((r) => r.studentId));
  const records = session.records.map((r) => ({
    studentId: r.studentId,
    status: r.status,
    full_name: usersMap[r.studentId]?.full_name || null,
    email: usersMap[r.studentId]?.email || null,
  }));

  return res.json(new ApiResponse(200, { batchId, date, markedBy: session.markedBy, records }));
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /attendance/batch/:batchId   (instructor owner / admin)
// History of all sessions for a batch, with per-session counts (admin portal)
// ─────────────────────────────────────────────────────────────────────────────
const getBatchAttendance = asyncHandler(async (req, res) => {
  const { batchId } = req.params;
  const batch = await loadBatchAuthorized(batchId, req.user);

  const sessions = await Attendance.find({ batchId }).sort({ date: -1 });

  const data = sessions.map((s) => {
    const counts = { present: 0, absent: 0, leave: 0 };
    s.records.forEach((r) => { counts[r.status] = (counts[r.status] || 0) + 1; });
    return {
      date: s.date,
      total: s.records.length,
      present: counts.present,
      absent: counts.absent,
      leave: counts.leave,
      markedBy: s.markedBy,
      updatedAt: s.updatedAt,
    };
  });

  // Per-student attendance summary toward the certificate (offline "progress").
  // Reuses the shared helper so numbers match the student/cert views exactly.
  const courseId = batch.courseId?._id || batch.courseId;
  const usersMap = await fetchUsersMap(batch.studentIds || []);
  const roster = await Promise.all(
    (batch.studentIds || []).map(async (sid) => {
      const att = await getOfflineAttendance(sid, courseId);
      return {
        studentId: sid,
        full_name: usersMap[sid]?.full_name || null,
        email: usersMap[sid]?.email || null,
        present: att?.present || 0,
        sessionsHeld: att?.sessionsHeld || sessions.length,
        totalClasses: att?.totalClasses || 0,
        rate: att?.rate || 0,
        eligible: !!att?.eligible,
        classesNeeded: att?.classesNeeded ?? null,
      };
    })
  );

  return res.json(new ApiResponse(200, {
    batch: { id: batch._id, name: batch.name, course: batch.courseId, studentCount: (batch.studentIds || []).length },
    sessions: data,
    roster,
    threshold: OFFLINE_ATTENDANCE_THRESHOLD,
  }));
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /attendance/my/:courseId   (student)
// The logged-in student's own attendance for their offline batch in a course,
// summarised against the course's total classes + the 80% certificate bar.
// ─────────────────────────────────────────────────────────────────────────────
const getMyAttendance = asyncHandler(async (req, res) => {
  const { courseId } = req.params;

  const att = await getOfflineAttendance(req.user.id, courseId);
  if (!att) {
    return res.json(new ApiResponse(200, null, "You are not in an offline batch for this course"));
  }

  const { batch, ...summary } = att;
  const usersMap = await fetchUsersMap([batch.instructorId]);

  return res.json(
    new ApiResponse(200, {
      batchName: batch.name,
      schedule: batch.schedule,
      location: batch.location,
      instructorName: usersMap[batch.instructorId]?.full_name || null,
      ...summary,
    })
  );
});

export { markAttendance, getAttendance, getBatchAttendance, getMyAttendance };
