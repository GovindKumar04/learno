import { Enrollment } from "../models/enrollment.model.js";
import { Progress } from "../models/progress.model.js";
import { Course } from "../models/course.model.js";
import { ApiError } from "../utils/ApiError.js";
import { sendBroadcastMail } from "../utils/mail.util.js";
import { getOfflineAttendance, getLiveAttendance } from "../utils/attendance.util.js";
import { escapeRegex } from "../utils/deleteGuard.util.js";
import { isUuid } from "../utils/id.util.js";
import pool from "../config/db.js";

export const checkMyEnrollmentService = async ({ userId, courseId }) => {
  const enrollment = await Enrollment.findOne({ userId, courseId, isActive: true }).select("enrollmentType");
  if (!enrollment) return { isEnrolled: false, enrollmentType: null };
  return { isEnrolled: true, enrollmentType: enrollment.enrollmentType };
};

// Admin enrolls a student. Returns { enrollment, reEnrolled } for the status code.
export const enrollStudentService = async ({ userId, courseId, enrollmentType = "self-paced", enrolledBy }) => {
  if (!userId || !courseId) throw new ApiError(400, "userId and courseId are required");

  const userResult = await pool.query("SELECT id, full_name, email, role FROM users WHERE id = $1", [userId]);
  if (userResult.rows.length === 0) throw new ApiError(404, "User not found");
  if (userResult.rows[0].role !== "student") throw new ApiError(400, "Only students can be enrolled in courses");

  const course = await Course.findById(courseId);
  if (!course) throw new ApiError(404, "Course not found");
  if (Array.isArray(course.modes) && course.modes.length && !course.modes.includes(enrollmentType)) {
    throw new ApiError(400, `This course is not available ${enrollmentType}.`);
  }

  const existing = await Enrollment.findOne({ userId, courseId });
  if (existing) {
    if (existing.isActive) throw new ApiError(409, "Student is already enrolled in this course");
    existing.isActive = true;
    existing.unenrolledAt = null;
    existing.enrolledBy = enrolledBy;
    existing.enrollmentType = enrollmentType;
    await existing.save();
    return { enrollment: existing, reEnrolled: true };
  }

  const enrollment = await Enrollment.create({ userId, courseId, enrolledBy, enrollmentType });
  await Progress.create({ userId, courseId });
  return { enrollment, reEnrolled: false };
};

export const unenrollStudentService = async (enrollmentId) => {
  const enrollment = await Enrollment.findById(enrollmentId);
  if (!enrollment) throw new ApiError(404, "Enrollment not found");
  if (!enrollment.isActive) throw new ApiError(400, "Student is already unenrolled");

  enrollment.isActive = false;
  enrollment.unenrolledAt = new Date();
  await enrollment.save();
  return enrollment;
};

export const getMyCoursesService = async (userId) => {
  const enrollments = (await Enrollment.find({ userId, isActive: true }).populate({
    path: "courseId",
    select: "title description thumbnail category level price slug duration",
  })).filter((e) => e.courseId);

  const progressDocs = await Progress.find({
    userId,
    courseId: { $in: enrollments.map((e) => e.courseId._id) },
  }).select("courseId completionPercent lastAccessedAt");

  const progressMap = {};
  progressDocs.forEach((p) => {
    progressMap[p.courseId.toString()] = { completionPercent: p.completionPercent, lastAccessedAt: p.lastAccessedAt };
  });

  // Per-course attendance is fetched concurrently (Promise.all). This is an N+1
  // over getOfflineAttendance, but bounded by ONE student's course count and run
  // in parallel, so it's left as-is; batch it only if students enroll in many
  // offline courses.
  return Promise.all(
    enrollments.map(async (e) => {
      const progress = progressMap[e.courseId._id.toString()] || { completionPercent: 0, lastAccessedAt: null };
      const base = {
        enrollmentId: e._id,
        enrolledAt: e.createdAt,
        enrollmentType: e.enrollmentType,
        course: e.courseId,
        progress,
      };

      // Classroom and Live are attendance-based (certificate by attendance %);
      // self-paced is progress-based (certificate at 100% material completion).
      if (e.enrollmentType === "classroom" || e.enrollmentType === "live") {
        const att = e.enrollmentType === "live"
          ? await getLiveAttendance(e.userId, e.courseId._id)
          : await getOfflineAttendance(e.userId, e.courseId._id);
        return {
          ...base,
          attendance: att
            ? { present: att.present, totalClasses: att.totalClasses, rate: att.rate, eligible: att.eligible, classesNeeded: att.classesNeeded }
            : null,
          // Classroom batch schedule/venue, so the Classes page can show its timing.
          schedule: att?.batch?.schedule || null,
          location: att?.batch?.location || null,
          completed: !!(att && att.eligible),
        };
      }
      return { ...base, completed: progress.completionPercent === 100 };
    })
  );
};

export const getCourseStudentsService = async ({ courseId, query, user }) => {
  const { page = 1, limit = 20 } = query;
  const pageNum = Number(page);
  const limitNum = Number(limit);

  const course = await Course.findById(courseId).select("title instructorId");
  if (!course) throw new ApiError(404, "Course not found");
  if (user.role === "instructor" && course.instructorId !== user.id) {
    throw new ApiError(403, "You can only view students in your own courses");
  }

  const [enrollments, total] = await Promise.all([
    Enrollment.find({ courseId, isActive: true }).skip((pageNum - 1) * limitNum).limit(limitNum).sort({ createdAt: -1 }),
    Enrollment.countDocuments({ courseId, isActive: true }),
  ]);

  if (enrollments.length === 0) return { students: [], total: 0, page: pageNum, limit: limitNum };

  const userIds = [...new Set(enrollments.map((e) => e.userId).filter(isUuid))];
  const placeholders = userIds.length ? userIds.map((_, i) => `$${i + 1}`).join(", ") : "NULL";
  const usersResult = await pool.query(
    `SELECT id, full_name, email, roll_number, phone, avatar FROM users WHERE id IN (${placeholders})`,
    userIds
  );
  const usersMap = {};
  usersResult.rows.forEach((u) => (usersMap[u.id] = u));

  const progressDocs = await Progress.find({ userId: { $in: userIds }, courseId })
    .select("userId completionPercent lastAccessedAt completedAt");
  const progressMap = {};
  progressDocs.forEach((p) => (progressMap[p.userId] = p));

  const students = enrollments.map((e) => ({
    enrollmentId: e._id,
    enrolledAt: e.createdAt,
    enrollmentType: e.enrollmentType,
    user: usersMap[e.userId] || { id: e.userId },
    progress: progressMap[e.userId] || { completionPercent: 0, lastAccessedAt: null, completedAt: null },
  }));

  return { students, total, page: pageNum, limit: limitNum };
};

export const getStudentEnrollmentsService = async (userId) => {
  const enrollments = (await Enrollment.find({ userId, isActive: true })
    .populate("courseId", "title thumbnail category level")).filter((e) => e.courseId);

  const progressDocs = await Progress.find({ userId }).select("courseId completionPercent lastAccessedAt completedAt");
  const progressMap = {};
  progressDocs.forEach((p) => (progressMap[p.courseId.toString()] = p));

  return enrollments.map((e) => ({
    enrollmentId: e._id,
    enrolledAt: e.createdAt,
    course: e.courseId,
    progress: progressMap[e.courseId._id.toString()] || { completionPercent: 0, lastAccessedAt: null },
  }));
};

export const getAllEnrollmentsService = async (query) => {
  const { page = 1, limit = 10, search = "" } = query;
  const pageNum = Math.max(1, Number(page) || 1);
  const limitNum = Math.min(100, Math.max(1, Number(limit) || 10)); // cap so limit=1e6 can't scan everything

  const filter = { isActive: true };

  // Search spans both databases — user name/email/roll live in Postgres, course
  // title/category in Mongo. Resolve the matching ids in each store first, then
  // filter enrollments by (userId ∈ matches) OR (courseId ∈ matches). This keeps
  // pagination and `total` correct at the DB level. (The old code paginated
  // first and filtered the resulting page in JS, so search only ever looked
  // inside the current page and `total` was wrong.)
  // Semantics note: the whole search string is matched as one phrase per field,
  // not ANDed token-by-token as before.
  if (search.trim()) {
    const term = search.trim();
    const [pgUsers, courses] = await Promise.all([
      pool.query(
        `SELECT id FROM users WHERE full_name ILIKE $1 OR email ILIKE $1 OR roll_number ILIKE $1`,
        [`%${term}%`]
      ),
      Course.find({
        $or: [
          { title: { $regex: escapeRegex(term), $options: "i" } },
          { category: { $regex: escapeRegex(term), $options: "i" } },
        ],
      }).select("_id"),
    ]);

    const matchedUserIds = pgUsers.rows.map((r) => String(r.id));
    const matchedCourseIds = courses.map((c) => c._id);
    if (matchedUserIds.length === 0 && matchedCourseIds.length === 0) {
      return { enrollments: [], total: 0, page: pageNum, limit: limitNum, totalPages: 0 };
    }

    filter.$or = [];
    if (matchedUserIds.length) filter.$or.push({ userId: { $in: matchedUserIds } });
    if (matchedCourseIds.length) filter.$or.push({ courseId: { $in: matchedCourseIds } });
  }

  const [enrollments, total] = await Promise.all([
    Enrollment.find(filter)
      .populate("courseId", "title category level thumbnail")
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum)
      .sort({ createdAt: -1 }),
    Enrollment.countDocuments(filter),
  ]);

  const totalPages = Math.ceil(total / limitNum);
  if (enrollments.length === 0) {
    return { enrollments: [], total, page: pageNum, limit: limitNum, totalPages };
  }

  // Only look up valid-UUID ids (legacy bigint refs can't exist in the new users table).
  const userIds = [...new Set(enrollments.map((e) => e.userId).filter(isUuid))];
  const usersMap = {};
  if (userIds.length) {
    const placeholders = userIds.map((_, i) => `$${i + 1}`).join(", ");
    const usersResult = await pool.query(
      `SELECT id, full_name, email, roll_number, phone, avatar FROM users WHERE id IN (${placeholders})`,
      userIds
    );
    usersResult.rows.forEach((u) => (usersMap[u.id] = u));
  }

  const data = enrollments.map((e) => ({
    id: e._id,
    enrolledAt: e.createdAt,
    enrollmentType: e.enrollmentType,
    user: usersMap[e.userId] || { id: e.userId },
    course: e.courseId,
  }));

  return { enrollments: data, total, page: pageNum, limit: limitNum, totalPages };
};

export const getUnenrolledStudentsService = async ({ search = "" }) => {
  // ids with an active enrollment (from Mongo) — userId is a string copy of the
  // UUID users.id. Drop any legacy non-UUID refs so the ::uuid[] cast can't fail.
  const enrolledIds = (await Enrollment.find({ isActive: true }).distinct("userId")).filter(isUuid);

  // Do the anti-join in Postgres so we never pull the whole users table into
  // Node (the old code SELECTed every student then filtered in a JS Set).
  const conditions = ["role = 'student'"];
  const params = [enrolledIds];
  conditions.push(`NOT (id = ANY($1::uuid[]))`); // empty array → excludes nobody

  if (search.trim()) {
    params.push(`%${search.trim()}%`);
    conditions.push(`(full_name ILIKE $${params.length} OR email ILIKE $${params.length} OR roll_number ILIKE $${params.length})`);
  }

  const result = await pool.query(
    `SELECT id, full_name, email, roll_number, phone, location, avatar, created_at
       FROM users WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC`,
    params
  );

  return { students: result.rows, total: result.rowCount };
};

// Bulk-email students. userIds given → those; absent → all unenrolled students.
export const broadcastEmailService = async ({ subject, message, userIds }) => {
  if (!subject?.trim() || !message?.trim()) throw new ApiError(400, "subject and message are required");

  let targetIds;
  if (Array.isArray(userIds) && userIds.length > 0) {
    targetIds = userIds;
  } else {
    // All unenrolled students — anti-join in Postgres rather than fetching every
    // student and filtering in a JS Set.
    const enrolledIds = (await Enrollment.find({ isActive: true }).distinct("userId")).filter(isUuid);
    const all = await pool.query(
      `SELECT id FROM users WHERE role = 'student' AND NOT (id = ANY($1::uuid[]))`,
      [enrolledIds]
    );
    targetIds = all.rows.map((r) => r.id);
  }

  if (targetIds.length === 0) throw new ApiError(400, "No recipients to email");

  const placeholders = targetIds.map((_, i) => `$${i + 1}`).join(", ");
  const usersResult = await pool.query(
    `SELECT id, full_name, email FROM users WHERE role = 'student' AND id IN (${placeholders})`,
    targetIds
  );
  if (usersResult.rows.length === 0) throw new ApiError(404, "No matching students found");

  const subjectClean = subject.trim();
  const messageClean = message.trim();

  // Throttled batches so a large blast doesn't trip SMTP rate limits.
  const BATCH_SIZE = 20;
  const BATCH_DELAY_MS = 1000;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const recipients = usersResult.rows;
  let sent = 0;
  let failed = 0;

  for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
    const batch = recipients.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map((u) => sendBroadcastMail({ name: u.full_name, email: u.email, subject: subjectClean, message: messageClean }))
    );
    sent += results.filter((r) => r.status === "fulfilled").length;
    failed += results.filter((r) => r.status === "rejected").length;
    if (i + BATCH_SIZE < recipients.length) await sleep(BATCH_DELAY_MS);
  }

  return { sent, failed, total: recipients.length };
};
