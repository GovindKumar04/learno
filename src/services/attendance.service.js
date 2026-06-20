import { Attendance } from "../models/attendance.model.js";
import { Batch } from "../models/batch.model.js";
import { Course } from "../models/course.model.js";
import { ApiError } from "../utils/ApiError.js";
import { isUuid } from "../utils/id.util.js";
import { getOfflineAttendance, getLiveAttendance } from "../utils/attendance.util.js";
import { OFFLINE_ATTENDANCE_THRESHOLD } from "../config/constants.js";
import { buildUserMap } from "../utils/userQuery.util.js";

const VALID_STATUS = ["present", "absent", "leave"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

async function fetchUsersMap(ids) {
  const unique = [...new Set(ids.filter(isUuid))];
  return buildUserMap(unique, "full_name email phone");
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

export const markAttendanceService = async ({
  batchId,
  date,
  records,
  user,
}) => {
  if (!batchId || !date)
    throw new ApiError(400, "batchId and date are required");
  if (!DATE_RE.test(date))
    throw new ApiError(400, "date must be in YYYY-MM-DD format");
  if (!Array.isArray(records) || records.length === 0)
    throw new ApiError(400, "records must be a non-empty array");

  const batch = await loadBatchAuthorized(batchId, user);
  // Live batches record attendance per live session (onlineClassId), not by date.
  // Marking one here would write batchId docs the student's live view never reads.
  if (batch.mode === "live") {
    throw new ApiError(400, "This is a live batch — mark attendance from its live class, not by date.");
  }
  const roster = new Set((batch.studentIds || []).map(String));

  // Don't let a batch exceed its course's planned number of classes. Editing an
  // already-recorded date is allowed; only new sessions beyond the limit blocked.
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
    if (!roster.has(studentId))
      throw new ApiError(400, `Student ${studentId} is not in this batch`);
    if (!VALID_STATUS.includes(status)) {
      throw new ApiError(
        400,
        `Invalid status "${r.status}" (use present, absent or leave)`,
      );
    }
    return { studentId, status };
  });

  return Attendance.findOneAndUpdate(
    { batchId, date },
    { $set: { courseId, records: clean, markedBy: user.id } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
};

// Returns one session's records (enriched) or null if not marked yet
export const getAttendanceService = async ({ batchId, date, user }) => {
  if (!batchId || !date)
    throw new ApiError(400, "batchId and date are required");
  await loadBatchAuthorized(batchId, user);

  const session = await Attendance.findOne({ batchId, date });
  if (!session) return null;

  const usersMap = await fetchUsersMap(session.records.map((r) => r.studentId));
  const records = session.records.map((r) => ({
    studentId: r.studentId,
    status: r.status,
    full_name: usersMap[r.studentId]?.full_name || null,
    email: usersMap[r.studentId]?.email || null,
  }));

  return { batchId, date, markedBy: session.markedBy, records };
};

export const getBatchAttendanceService = async ({ batchId, user }) => {
  const batch = await loadBatchAuthorized(batchId, user);
  const sessions = await Attendance.find({ batchId }).sort({ date: -1 });

  const data = sessions.map((s) => {
    const counts = { present: 0, absent: 0, leave: 0 };
    s.records.forEach((r) => {
      counts[r.status] = (counts[r.status] || 0) + 1;
    });
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
    }),
  );

  return {
    batch: {
      id: batch._id,
      name: batch.name,
      course: batch.courseId,
      studentCount: (batch.studentIds || []).length,
    },
    sessions: data,
    roster,
    threshold: OFFLINE_ATTENDANCE_THRESHOLD,
  };
};

// The logged-in student's own attendance for their classroom batch OR live
// classes in a course. Classroom returns batch details; live has no batch.
export const getMyAttendanceService = async ({ courseId, userId }) => {
  const off = await getOfflineAttendance(userId, courseId);
  if (off) {
    const { batch, ...summary } = off;
    const usersMap = await fetchUsersMap([batch.instructorId]);
    return {
      mode: "classroom",
      batchName: batch.name,
      schedule: batch.schedule,
      location: batch.location,
      instructorName: usersMap[batch.instructorId]?.full_name || null,
      ...summary,
    };
  }

  const live = await getLiveAttendance(userId, courseId);
  if (live) return { mode: "live", ...live };

  return null;
};
