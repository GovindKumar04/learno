import { Certificate } from "../models/certificate.model.js";
import { Progress } from "../models/progress.model.js";
import { Course } from "../models/course.model.js";
import { Batch } from "../models/batch.model.js";
import { Attendance } from "../models/attendance.model.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { sendCertificateMail } from "../utils/mail.util.js";
import { generateCertificatePDF, buildCertificateNo } from "../utils/certificate.util.js";
import { getOfflineAttendance } from "../utils/attendance.util.js";
import { OFFLINE_ATTENDANCE_THRESHOLD } from "../config/constants.js";
import pool from "../config/db.js";

// ─────────────────────────────────────────────────────────────────────────────
// Offline completion: a student in an offline batch qualifies once they've been
// marked "present" for at least OFFLINE_ATTENDANCE_THRESHOLD% of the course's
// configured total classes. Denominator is course.totalClasses (set per course)
// — NOT sessions-held-so-far — so eligibility can't trigger early in a batch.
// ─────────────────────────────────────────────────────────────────────────────

// Bulk: every (userId, courseId) offline pair that currently meets the bar.
async function offlineCompletions() {
  const batches = await Batch.find({}).select("courseId studentIds");
  if (batches.length === 0) return [];

  const courseIds = [...new Set(batches.map((b) => b.courseId.toString()))];
  const courses = await Course.find({ _id: { $in: courseIds } }).select("totalClasses");
  const totalMap = {};
  courses.forEach((c) => (totalMap[c._id.toString()] = c.totalClasses || 0));

  const batchIds = batches.map((b) => b._id);
  const sessions = await Attendance.find({ batchId: { $in: batchIds } }).select("batchId records");
  const sessionsByBatch = {};
  sessions.forEach((s) => {
    (sessionsByBatch[s.batchId.toString()] ||= []).push(s);
  });

  // Accumulate present counts per (userId, courseId) across that course's batches
  const acc = new Map();
  for (const b of batches) {
    const courseId = b.courseId.toString();
    const bsessions = sessionsByBatch[b._id.toString()] || [];
    for (const studentId of b.studentIds || []) {
      let present = 0;
      for (const s of bsessions) {
        if (s.records.some((r) => String(r.studentId) === String(studentId) && r.status === "present")) present++;
      }
      const key = `${studentId}:${courseId}`;
      const prev = acc.get(key) || { present: 0, userId: String(studentId), courseId };
      prev.present += present;
      acc.set(key, prev);
    }
  }

  const out = [];
  for (const { present, userId, courseId } of acc.values()) {
    const totalClasses = totalMap[courseId] || 0;
    if (totalClasses <= 0) continue; // course hasn't defined its class count
    const rate = Math.round((present / totalClasses) * 100);
    if (rate >= OFFLINE_ATTENDANCE_THRESHOLD) out.push({ userId, courseId, present, totalClasses, rate });
  }
  return out;
}

// A student has "completed" a course if they finished it online (100% progress)
// OR met the offline attendance bar (see utils/attendance.util.js).
async function hasCompleted(userId, courseId) {
  const progress = await Progress.findOne({ userId, courseId }).select("completionPercent");
  if (progress && progress.completionPercent >= 100) return true;
  const off = await getOfflineAttendance(userId, courseId);
  return !!(off && off.eligible);
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /certificates/eligible  (admin only)
// Students who have completed a course — either online (progress 100%) or
// offline (attendance ≥ threshold of the course's total classes) — enriched
// with student + course names, completion source, and issued status.
// ─────────────────────────────────────────────────────────────────────────────
const getEligibleStudents = asyncHandler(async (req, res) => {
  // Online completions (100% progress) + offline completions (attendance)
  const [completed, offline] = await Promise.all([
    Progress.find({ completionPercent: 100 }).select("userId courseId completedAt").sort({ completedAt: -1 }),
    offlineCompletions(),
  ]);

  // Merge into one keyed map; online takes precedence if a pair appears in both
  const rows = new Map();
  for (const p of completed) {
    rows.set(`${p.userId}:${p.courseId.toString()}`, {
      userId: p.userId,
      courseId: p.courseId.toString(),
      source: "online",
      completedAt: p.completedAt,
      attendance: null,
    });
  }
  for (const o of offline) {
    const key = `${o.userId}:${o.courseId}`;
    if (rows.has(key)) continue;
    rows.set(key, {
      userId: o.userId,
      courseId: o.courseId,
      source: "offline",
      completedAt: null,
      attendance: { present: o.present, totalClasses: o.totalClasses, rate: o.rate },
    });
  }

  if (rows.size === 0) {
    return res.json(new ApiResponse(200, { students: [], total: 0, attendanceThreshold: OFFLINE_ATTENDANCE_THRESHOLD }));
  }

  const allRows = [...rows.values()];

  // Resolve course titles (Mongo)
  const courseIds = [...new Set(allRows.map((r) => r.courseId))];
  const courses = await Course.find({ _id: { $in: courseIds } }).select("title");
  const courseMap = {};
  courses.forEach((c) => (courseMap[c._id.toString()] = c.title));

  // Resolve student details (PostgreSQL) — only students get certificates
  const userIds = [...new Set(allRows.map((r) => r.userId))];
  const placeholders = userIds.map((_, i) => `$${i + 1}`).join(", ");
  const usersResult = await pool.query(
    `SELECT id, full_name, email, roll_number, avatar FROM users
       WHERE role = 'student' AND id IN (${placeholders})`,
    userIds
  );
  const userMap = {};
  usersResult.rows.forEach((u) => (userMap[u.id] = u));

  // Which (userId, courseId) pairs already have a certificate
  const issued = await Certificate.find({}).select("userId courseId certificateNo issuedAt");
  const issuedMap = {};
  issued.forEach((c) => (issuedMap[`${c.userId}:${c.courseId.toString()}`] = c));

  // Build rows — skip whose course was deleted or whose user isn't a student
  const students = allRows
    .map((r) => {
      const user = userMap[r.userId];
      const courseName = courseMap[r.courseId];
      if (!user || !courseName) return null;
      const cert = issuedMap[`${r.userId}:${r.courseId}`];
      return {
        userId: r.userId,
        courseId: r.courseId,
        full_name: user.full_name,
        email: user.email,
        roll_number: user.roll_number,
        avatar: user.avatar,
        courseName,
        source: r.source,
        completedAt: r.completedAt,
        attendance: r.attendance,
        certificateNo: cert?.certificateNo || null,
        issuedAt: cert?.issuedAt || null,
      };
    })
    .filter(Boolean);

  return res.json(new ApiResponse(200, { students, total: students.length, attendanceThreshold: OFFLINE_ATTENDANCE_THRESHOLD }));
});

// ─────────────────────────────────────────────────────────────────────────────
// Helper: reserve the next certificate number for the current year.
// Reads the highest number issued this year. `offset` lets a bulk loop hand out
// consecutive numbers without re-querying for each one.
// ─────────────────────────────────────────────────────────────────────────────
const nextCertSeq = async (year) => {
  const prefix = `FSA-CERT-${String(year).slice(-2)}-`;
  const last = await Certificate.findOne({ certificateNo: new RegExp(`^${prefix}`) })
    .sort({ certificateNo: -1 })
    .select("certificateNo");
  if (!last) return 1;
  const tail = parseInt(last.certificateNo.slice(prefix.length), 10);
  return Number.isNaN(tail) ? 1 : tail + 1;
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /certificates/issue  (admin only)
// Body: { items: [{ userId, courseId }, ...] }   (single = array of one)
// For each: verify completion, generate/reuse a certificate number, render the
// PDF, email it to the student, and record the certificate. Re-issuing reuses
// the existing number and just re-sends the email.
// ─────────────────────────────────────────────────────────────────────────────
const issueCertificates = asyncHandler(async (req, res) => {
  const { items } = req.body;

  if (!Array.isArray(items) || items.length === 0) {
    throw new ApiError(400, "items must be a non-empty array of { userId, courseId }");
  }

  const year = new Date().getFullYear();
  let nextSeq = await nextCertSeq(year);

  let sent = 0;
  let failed = 0;
  const errors = [];

  for (const item of items) {
    const { userId, courseId } = item || {};
    try {
      if (!userId || !courseId) throw new Error("userId and courseId are required");

      // Verify the student completed this course — online (100%) or offline (attendance)
      if (!(await hasCompleted(userId, courseId))) {
        throw new Error("Student has not completed this course (online progress or offline attendance)");
      }

      // Verify student + course exist
      const [userResult, course] = await Promise.all([
        pool.query("SELECT full_name, email, role FROM users WHERE id = $1", [userId]),
        Course.findById(courseId).select("title"),
      ]);
      const user = userResult.rows[0];
      if (!user || user.role !== "student") throw new Error("Student not found");
      if (!course) throw new Error("Course not found");

      // Reuse an existing certificate number, or reserve a fresh one
      let existing = await Certificate.findOne({ userId, courseId }).select("certificateNo");
      const certificateNo = existing
        ? existing.certificateNo
        : buildCertificateNo(year, nextSeq);

      const issuedAt = new Date();
      const pdfBuffer = await generateCertificatePDF({
        studentName: user.full_name,
        courseName: course.title,
        certificateNo,
        issuedAt,
      });

      await sendCertificateMail({
        name: user.full_name,
        email: user.email,
        courseName: course.title,
        certificateNo,
        pdfBuffer,
      });

      // Record (or refresh) the certificate only after the email succeeds
      await Certificate.findOneAndUpdate(
        { userId, courseId },
        {
          userId,
          courseId,
          certificateNo,
          studentName: user.full_name,
          courseName: course.title,
          email: user.email,
          issuedBy: req.user.id,
          issuedAt,
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );

      if (!existing) nextSeq += 1; // consumed a new number
      sent += 1;
    } catch (err) {
      failed += 1;
      errors.push({ userId, courseId, error: err.message });
    }
  }

  return res.json(
    new ApiResponse(
      200,
      { sent, failed, total: items.length, errors },
      `Certificate issued to ${sent} student(s)${failed ? `, ${failed} failed` : ""}`
    )
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /certificates  (admin only) — all issued certificates, newest first
// ─────────────────────────────────────────────────────────────────────────────
const getIssuedCertificates = asyncHandler(async (req, res) => {
  const certs = await Certificate.find({}).sort({ issuedAt: -1 });
  return res.json(new ApiResponse(200, { certificates: certs, total: certs.length }));
});

export { getEligibleStudents, issueCertificates, getIssuedCertificates };
