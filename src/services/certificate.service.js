import { Certificate } from "../models/certificate.model.js";
import { Progress } from "../models/progress.model.js";
import { Course } from "../models/course.model.js";
import { Batch } from "../models/batch.model.js";
import { Attendance } from "../models/attendance.model.js";
import { OnlineClass } from "../models/onlineClass.model.js";
import { Enrollment } from "../models/enrollment.model.js";
import { ApiError } from "../utils/ApiError.js";
import { sendCertificateMail } from "../utils/mail.util.js";
import { generateCertificatePDF, buildCertificateNo } from "../utils/certificate.util.js";
import { getOfflineAttendance, getLiveAttendance } from "../utils/attendance.util.js";
import { OFFLINE_ATTENDANCE_THRESHOLD } from "../config/constants.js";
import pool from "../config/db.js";

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
  sessions.forEach((s) => { (sessionsByBatch[s.batchId.toString()] ||= []).push(s); });

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
    if (totalClasses <= 0) continue;
    const rate = Math.round((present / totalClasses) * 100);
    if (rate >= OFFLINE_ATTENDANCE_THRESHOLD) out.push({ userId, courseId, present, totalClasses, rate });
  }
  return out;
}

// Bulk: every (userId, courseId) LIVE pair that currently meets the attendance
// bar, measured against the course's totalLiveClasses. Mirrors offlineCompletions.
async function liveCompletions() {
  const liveEnrolls = await Enrollment.find({ enrollmentType: "live", isActive: true }).select("userId courseId");
  if (liveEnrolls.length === 0) return [];

  const courseIds = [...new Set(liveEnrolls.map((e) => e.courseId.toString()))];
  const courses = await Course.find({ _id: { $in: courseIds } }).select("totalLiveClasses");
  const totalMap = {};
  courses.forEach((c) => (totalMap[c._id.toString()] = c.totalLiveClasses || 0));

  const sessions = await OnlineClass.find({ courseId: { $in: courseIds } }).select("_id courseId");
  if (sessions.length === 0) return [];
  const courseBySession = {};
  sessions.forEach((s) => (courseBySession[s._id.toString()] = s.courseId.toString()));

  const attendance = await Attendance.find({
    onlineClassId: { $in: sessions.map((s) => s._id) },
  }).select("onlineClassId records");

  const acc = new Map();
  for (const a of attendance) {
    const courseId = courseBySession[a.onlineClassId?.toString()];
    if (!courseId) continue;
    for (const r of a.records) {
      if (r.status !== "present") continue;
      const key = `${r.studentId}:${courseId}`;
      const prev = acc.get(key) || { present: 0, userId: String(r.studentId), courseId };
      prev.present += 1;
      acc.set(key, prev);
    }
  }

  const out = [];
  for (const { present, userId, courseId } of acc.values()) {
    const totalClasses = totalMap[courseId] || 0;
    if (totalClasses <= 0) continue;
    const rate = Math.min(100, Math.round((present / totalClasses) * 100));
    if (rate >= OFFLINE_ATTENDANCE_THRESHOLD) out.push({ userId, courseId, present, totalClasses, rate });
  }
  return out;
}

// Completed self-paced (100% progress) OR classroom/live (attendance bar met)
async function hasCompleted(userId, courseId) {
  const progress = await Progress.findOne({ userId, courseId }).select("completionPercent");
  if (progress && progress.completionPercent >= 100) return true;
  const off = await getOfflineAttendance(userId, courseId);
  if (off && off.eligible) return true;
  const live = await getLiveAttendance(userId, courseId);
  return !!(live && live.eligible);
}

// Reserve the next certificate number for the current year.
const nextCertSeq = async (year) => {
  const prefix = `FSA-CERT-${String(year).slice(-2)}-`;
  const last = await Certificate.findOne({ certificateNo: new RegExp(`^${prefix}`) })
    .sort({ certificateNo: -1 })
    .select("certificateNo");
  if (!last) return 1;
  const tail = parseInt(last.certificateNo.slice(prefix.length), 10);
  return Number.isNaN(tail) ? 1 : tail + 1;
};

export const getEligibleStudentsService = async () => {
  const [completed, offline, live] = await Promise.all([
    Progress.find({ completionPercent: 100 }).select("userId courseId completedAt").sort({ completedAt: -1 }),
    offlineCompletions(),
    liveCompletions(),
  ]);

  const rows = new Map();
  for (const p of completed) {
    rows.set(`${p.userId}:${p.courseId.toString()}`, {
      userId: p.userId,
      courseId: p.courseId.toString(),
      source: "self-paced",
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
      source: "classroom",
      completedAt: null,
      attendance: { present: o.present, totalClasses: o.totalClasses, rate: o.rate },
    });
  }
  for (const l of live) {
    const key = `${l.userId}:${l.courseId}`;
    if (rows.has(key)) continue;
    rows.set(key, {
      userId: l.userId,
      courseId: l.courseId,
      source: "live",
      completedAt: null,
      attendance: { present: l.present, totalClasses: l.totalClasses, rate: l.rate },
    });
  }

  if (rows.size === 0) {
    return { students: [], total: 0, attendanceThreshold: OFFLINE_ATTENDANCE_THRESHOLD };
  }

  const allRows = [...rows.values()];

  const courseIds = [...new Set(allRows.map((r) => r.courseId))];
  const courses = await Course.find({ _id: { $in: courseIds } }).select("title");
  const courseMap = {};
  courses.forEach((c) => (courseMap[c._id.toString()] = c.title));

  const userIds = [...new Set(allRows.map((r) => r.userId))];
  const placeholders = userIds.map((_, i) => `$${i + 1}`).join(", ");
  const usersResult = await pool.query(
    `SELECT id, full_name, email, roll_number, avatar FROM users
       WHERE role = 'student' AND id IN (${placeholders})`,
    userIds
  );
  const userMap = {};
  usersResult.rows.forEach((u) => (userMap[u.id] = u));

  const issued = await Certificate.find({}).select("userId courseId certificateNo issuedAt");
  const issuedMap = {};
  issued.forEach((c) => (issuedMap[`${c.userId}:${c.courseId.toString()}`] = c));

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

  return { students, total: students.length, attendanceThreshold: OFFLINE_ATTENDANCE_THRESHOLD };
};

// items: [{ userId, courseId }]. Verifies completion, renders + emails the PDF,
// records the certificate. Re-issuing reuses the existing number.
export const issueCertificatesService = async ({ items, issuedBy }) => {
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
      if (!(await hasCompleted(userId, courseId))) {
        throw new Error("Student has not completed this course (self-paced progress, or classroom/live attendance)");
      }

      const [userResult, course] = await Promise.all([
        pool.query("SELECT full_name, email, role FROM users WHERE id = $1", [userId]),
        Course.findById(courseId).select("title"),
      ]);
      const user = userResult.rows[0];
      if (!user || user.role !== "student") throw new Error("Student not found");
      if (!course) throw new Error("Course not found");

      const existing = await Certificate.findOne({ userId, courseId }).select("certificateNo");
      const certificateNo = existing ? existing.certificateNo : buildCertificateNo(year, nextSeq);

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

      await Certificate.findOneAndUpdate(
        { userId, courseId },
        {
          userId,
          courseId,
          certificateNo,
          studentName: user.full_name,
          courseName: course.title,
          email: user.email,
          issuedBy,
          issuedAt,
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );

      if (!existing) nextSeq += 1;
      sent += 1;
    } catch (err) {
      failed += 1;
      errors.push({ userId, courseId, error: err.message });
    }
  }

  return { sent, failed, total: items.length, errors };
};

export const getIssuedCertificatesService = async () => {
  const certs = await Certificate.find({}).sort({ issuedAt: -1 });
  return { certificates: certs, total: certs.length };
};
