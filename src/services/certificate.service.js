import { randomUUID } from "crypto";
import { Certificate } from "../models/certificate.model.js";
import { Counter } from "../models/counter.model.js";
import { Progress } from "../models/progress.model.js";
import { Course } from "../models/course.model.js";
import { Batch } from "../models/batch.model.js";
import { Attendance } from "../models/attendance.model.js";
import { OnlineClass } from "../models/onlineClass.model.js";
import { Enrollment } from "../models/enrollment.model.js";
import { ApiError } from "../utils/ApiError.js";
import { isUuid } from "../utils/id.util.js";
import { sendCertificateMail } from "../utils/mail.util.js";
import { generateCertificatePDF, buildCertificateNo } from "../utils/certificate.util.js";
import { getOfflineAttendance, getLiveAttendance } from "../utils/attendance.util.js";
import { OFFLINE_ATTENDANCE_THRESHOLD } from "../config/constants.js";
import { User } from "../models/user.model.js";

// Bulk: every (userId, courseId) offline pair that currently meets the bar.
async function offlineCompletions() {
  // Classroom batches only — live batches record attendance under onlineClassId
  // and are handled by liveCompletions(), measured against totalLiveClasses.
  const batches = await Batch.find({ mode: { $ne: "live" } }).select("courseId studentIds");
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

// Reserve the next certificate sequence value via one global, atomic, monotonic
// counter. Because the counter only ever increments and is never derived from
// the certificate rows, sequence values are NEVER reused when certificates are
// deleted, and concurrent issuance can't collide. buildCertificateNo() turns the
// value into the printed FTCTF-… number.
const nextCertSeq = async () => {
  const counter = await Counter.findByIdAndUpdate(
    "cert-seq",
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return counter.seq;
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

  const userIds = [...new Set(allRows.map((r) => r.userId).filter(isUuid))];
  const studentDocs = await User.find({ _id: { $in: userIds }, role: "student" })
    .select("full_name email roll_number avatar").lean();
  const userMap = {};
  studentDocs.forEach((u) => (userMap[u._id] = { ...u, id: u._id }));

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

      const [user, course] = await Promise.all([
        User.findById(userId).select("full_name email role").lean(),
        Course.findById(courseId).select("title"),
      ]);
      if (!user || user.role !== "student") throw new Error("Student not found");
      if (!course) throw new Error("Course not found");

      const existing = await Certificate.findOne({ userId, courseId }).select("certificateNo");
      // Reserve a fresh number only for a genuinely new certificate; re-issuing
      // keeps the original number so a student's certificate id never changes.
      const certificateNo = existing ? existing.certificateNo : buildCertificateNo(await nextCertSeq());

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

      sent += 1;
    } catch (err) {
      failed += 1;
      errors.push({ userId, courseId, error: err.message });
    }
  }

  return { sent, failed, total: items.length, errors };
};

// Admin override: generate a certificate on demand for ANY name and ANY course,
// with no completion/eligibility check. Handles two cases:
//   • Portal course selected  → courseId set, courseName snapshotted from it.
//   • Custom course typed      → courseId null, courseName is the typed title.
// The certificate is always recorded and the PDF returned for download; if an
// email is supplied it is also emailed. Each call mints a fresh certificate
// (unique synthetic userId), so re-generating never clobbers a prior record.
export const issueManualCertificateService = async ({
  studentName, email, courseId, courseName, type, fromDate, toDate, department,
  signatoryName, signatoryDesignation, trainerName, trainerDesignation, issuedBy,
}) => {
  const name = (studentName || "").trim();
  if (!name) throw new ApiError(400, "studentName is required");

  const certType = type === "internship" ? "internship" : "completion";

  // Signatories: both blocks have an entered name + a selectable designation.
  // Fall back to defaults when a field is left blank.
  const leftName = (signatoryName || "").trim() || "Khushi Bharti";
  const leftRole = (signatoryDesignation || "").trim() || "IT Team Lead";
  const rightName = (trainerName || "").trim() || "Shruti Sinha";
  const rightRole = (trainerDesignation || "").trim() || "Trainer";
  const signatories = {
    left: { name: leftName, role: leftRole },
    right: { name: rightName, role: rightRole },
  };

  // Optional internship duration — parse valid dates, ignore blanks/garbage.
  const parseDate = (v) => {
    if (!v) return undefined;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? undefined : d;
  };
  const from = certType === "internship" ? parseDate(fromDate) : undefined;
  const to = certType === "internship" ? parseDate(toDate) : undefined;
  if (from && to && from > to) throw new ApiError(400, "‘From’ date must be on or before the ‘To’ date");

  let resolvedCourseName = (courseName || "").trim();
  let resolvedCourseId = null;

  if (courseId) {
    const course = await Course.findById(courseId).select("title");
    if (!course) throw new ApiError(404, "Selected course not found");
    resolvedCourseId = course._id;
    resolvedCourseName = course.title; // snapshot the authoritative title
  }
  if (!resolvedCourseName) {
    throw new ApiError(400, certType === "internship" ? "Select or enter an internship domain" : "Select a course or enter a course name");
  }

  const cleanEmail = (email || "").trim();

  const issuedAt = new Date();
  const certificateNo = buildCertificateNo(await nextCertSeq(), issuedAt);

  const pdfBuffer = await generateCertificatePDF({
    studentName: name,
    courseName: resolvedCourseName,
    certificateNo,
    issuedAt,
    type: certType,
    fromDate: from,
    toDate: to,
    department: certType === "internship" ? (department || "").trim() || undefined : undefined,
    signatories,
  });

  // Email is best-effort — a delivery failure must not block the download the
  // admin is waiting on. Report back whether it actually went out.
  let emailed = false;
  if (cleanEmail) {
    try {
      await sendCertificateMail({
        name,
        email: cleanEmail,
        courseName: resolvedCourseName,
        certificateNo,
        pdfBuffer,
      });
      emailed = true;
    } catch {
      emailed = false;
    }
  }

  await Certificate.create({
    userId: `manual:${randomUUID()}`,
    courseId: resolvedCourseId,
    certificateNo,
    studentName: name,
    courseName: resolvedCourseName,
    email: cleanEmail || undefined,
    isManual: true,
    type: certType,
    fromDate: from,
    toDate: to,
    department: certType === "internship" ? (department || "").trim() || undefined : undefined,
    signatoryName: leftName,
    signatoryDesignation: leftRole,
    trainerName: rightName,
    trainerDesignation: rightRole,
    issuedBy,
    issuedAt,
  });

  return {
    certificateNo,
    studentName: name,
    courseName: resolvedCourseName,
    email: cleanEmail || null,
    emailed,
    type: certType,
    issuedAt,
    pdfBase64: pdfBuffer.toString("base64"),
  };
};

// Admin: the log of manually generated certificates, newest first. Optionally
// filter by type ("completion" | "internship").
export const getManualCertificatesService = async ({ type } = {}) => {
  const query = { isManual: true };
  if (type === "internship" || type === "completion") query.type = type;
  const certificates = await Certificate.find(query).sort({ issuedAt: -1 }).lean();
  return { certificates, total: certificates.length };
};

// Admin: re-render any stored certificate's PDF by its id (used to re-download
// manual certificates, which have no {userId, courseId} pair to look up by).
export const getCertificatePdfByIdService = async ({ id }) => {
  const cert = await Certificate.findById(id);
  if (!cert) throw new ApiError(404, "Certificate not found");
  return renderStoredCertificate(cert);
};

export const getIssuedCertificatesService = async () => {
  const certs = await Certificate.find({}).sort({ issuedAt: -1 });
  return { certificates: certs, total: certs.length };
};

// Re-render the PDF for an already-issued certificate. We never store the file —
// the record (name/course/number/date) is the source of truth, so the download
// is regenerated identically on demand. Returns the buffer + a filename.
// Rebuild the signatories object from the stored fields, if any were saved.
const storedSignatories = (cert) => {
  if (!cert.signatoryName && !cert.trainerName && !cert.signatoryDesignation && !cert.trainerDesignation) return undefined;
  return {
    left: { name: cert.signatoryName || "Khushi Bharti", role: cert.signatoryDesignation || "IT Team Lead" },
    right: { name: cert.trainerName || "Shruti Sinha", role: cert.trainerDesignation || "Trainer" },
  };
};

const renderStoredCertificate = (cert) =>
  generateCertificatePDF({
    studentName: cert.studentName,
    courseName: cert.courseName,
    certificateNo: cert.certificateNo,
    issuedAt: cert.issuedAt,
    type: cert.type, // keep the same template (completion / internship) on re-download
    fromDate: cert.fromDate,
    toDate: cert.toDate,
    department: cert.department,
    signatories: storedSignatories(cert),
  }).then((pdfBuffer) => ({ pdfBuffer, fileName: `${cert.certificateNo}.pdf` }));

// Admin: download by (userId, courseId) — the keys the eligible-students list
// already carries for each row.
export const getCertificatePdfService = async ({ userId, courseId }) => {
  if (!userId || !courseId) throw new ApiError(400, "userId and courseId are required");
  const cert = await Certificate.findOne({ userId, courseId });
  if (!cert) throw new ApiError(404, "No certificate has been issued for this student yet");
  return renderStoredCertificate(cert);
};

// Student: list the certificates issued to me, enriched with course slug/thumbnail
// so the portal can show a card and link back to the course.
export const getMyCertificatesService = async ({ userId }) => {
  const certs = await Certificate.find({ userId }).sort({ issuedAt: -1 }).lean();
  if (certs.length === 0) return { certificates: [], total: 0 };

  const courseIds = [...new Set(certs.map((c) => c.courseId?.toString()).filter(Boolean))];
  const courses = await Course.find({ _id: { $in: courseIds } }).select("slug title thumbnail").lean();
  const courseMap = {};
  courses.forEach((c) => (courseMap[c._id.toString()] = c));

  const certificates = certs.map((c) => {
    const course = courseMap[c.courseId?.toString()];
    return {
      id: c._id,
      certificateNo: c.certificateNo,
      courseId: c.courseId,
      courseName: c.courseName,
      studentName: c.studentName,
      issuedAt: c.issuedAt,
      courseSlug: course?.slug || null,
      courseThumbnail: course?.thumbnail || null,
    };
  });
  return { certificates, total: certificates.length };
};

// Student: download one of MY certificates (ownership enforced via userId).
export const getMyCertificatePdfService = async ({ userId, certId }) => {
  const cert = await Certificate.findOne({ _id: certId, userId });
  if (!cert) throw new ApiError(404, "Certificate not found");
  return renderStoredCertificate(cert);
};
