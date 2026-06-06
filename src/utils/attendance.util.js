import { Batch } from "../models/batch.model.js";
import { Attendance } from "../models/attendance.model.js";
import { Course } from "../models/course.model.js";
import { OFFLINE_ATTENDANCE_THRESHOLD } from "../config/constants.js";

// ─────────────────────────────────────────────────────────────────────────────
// Single source of truth for one student's offline attendance in one course.
// Returns null if the student isn't in an offline batch for the course; else a
// summary measured against the course's total classes and the certificate bar.
//   present       — sessions marked "present" for this student
//   totalClasses  — course.totalClasses (denominator; NOT sessions-held)
//   sessionsHeld  — how many sessions have actually been recorded so far
//   rate          — round(present / totalClasses * 100)
//   eligible      — rate >= OFFLINE_ATTENDANCE_THRESHOLD (and totalClasses set)
//   classesNeeded — more "present" classes required to qualify (0 if eligible)
//   batch         — the student's primary Batch doc (schedule/location/instructor)
// ─────────────────────────────────────────────────────────────────────────────
export async function getOfflineAttendance(userId, courseId) {
  const batches = await Batch.find({ courseId, studentIds: userId });
  if (batches.length === 0) return null;

  const course = await Course.findById(courseId).select("totalClasses");
  const totalClasses = course?.totalClasses || 0;

  const sessions = await Attendance.find({
    batchId: { $in: batches.map((b) => b._id) },
  }).select("records");

  const sessionsHeld = sessions.length;
  let present = 0;
  for (const s of sessions) {
    if (s.records.some((r) => String(r.studentId) === String(userId) && r.status === "present")) present++;
  }

  // Cap at 100%: instructors can hold more sessions than the planned
  // totalClasses, so `present` may exceed the denominator. A student can't be
  // "more than fully" attended.
  const rate = totalClasses > 0 ? Math.min(100, Math.round((present / totalClasses) * 100)) : 0;
  const eligible = totalClasses > 0 && rate >= OFFLINE_ATTENDANCE_THRESHOLD;
  const classesNeeded = totalClasses > 0
    ? Math.max(0, Math.ceil((OFFLINE_ATTENDANCE_THRESHOLD / 100) * totalClasses) - present)
    : null;

  return {
    present,
    totalClasses,
    sessionsHeld,
    rate,
    eligible,
    classesNeeded,
    threshold: OFFLINE_ATTENDANCE_THRESHOLD,
    batch: batches[0],
  };
}
