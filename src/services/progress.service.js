import { Progress } from "../models/progress.model.js";
import { Enrollment } from "../models/enrollment.model.js";
import { Course } from "../models/course.model.js";
import { Module } from "../models/module.model.js";
import { TeachingRequest } from "../models/teachingRequest.model.js";
import { ApiError } from "../utils/ApiError.js";
import { getOfflineAttendance, getLiveAttendance } from "../utils/attendance.util.js";
import pool from "../config/db.js";

// Recalculate completionPercent for a progress document
const recalcProgress = async (progressDoc, totalMaterials) => {
  if (totalMaterials === 0) {
    progressDoc.completionPercent = 0;
    return;
  }
  const uniqueIds = new Set(progressDoc.completedMaterials.map((m) => m.materialId.toString()));
  const percent = Math.round((uniqueIds.size / totalMaterials) * 100);
  progressDoc.completionPercent = Math.min(percent, 100);
  if (progressDoc.completionPercent === 100 && !progressDoc.completedAt) {
    progressDoc.completedAt = new Date();
  }
};

const getTotalMaterials = async (courseId) => {
  const modules = await Module.find({ course: courseId }).select("materials");
  return modules.reduce((sum, m) => sum + m.materials.length, 0);
};

export const markMaterialWatchedService = async ({ userId, courseId, materialId, watchPercent = 100 }) => {
  if (!courseId || !materialId) throw new ApiError(400, "courseId and materialId are required");

  const enrollment = await Enrollment.findOne({ userId, courseId, isActive: true });
  if (!enrollment) throw new ApiError(403, "You are not enrolled in this course");
  if (enrollment.enrollmentType !== "self-paced") {
    throw new ApiError(403, "Classroom and live courses are tracked by attendance, not material progress");
  }

  let progress = await Progress.findOne({ userId, courseId });
  if (!progress) progress = await Progress.create({ userId, courseId });

  const alreadyWatched = progress.completedMaterials.find(
    (m) => m.materialId.toString() === materialId && m.watchPercent === 100
  );

  if (!alreadyWatched) {
    progress.completedMaterials.push({ materialId, watchedAt: new Date(), watchPercent: Number(watchPercent) });
  } else if (Number(watchPercent) > alreadyWatched.watchPercent) {
    alreadyWatched.watchPercent = Number(watchPercent);
    alreadyWatched.watchedAt = new Date();
  }

  progress.lastAccessedAt = new Date();

  const totalMaterials = await getTotalMaterials(courseId);
  await recalcProgress(progress, totalMaterials);
  await progress.save();

  return {
    completionPercent: progress.completionPercent,
    completedAt: progress.completedAt,
    totalMaterials,
    completedMaterials: new Set(progress.completedMaterials.map((m) => m.materialId.toString())).size,
  };
};

export const getMyProgressService = async ({ userId, courseId }) => {
  const enrollment = await Enrollment.findOne({ userId, courseId, isActive: true });
  if (!enrollment) throw new ApiError(403, "You are not enrolled in this course");

  const [progress, course] = await Promise.all([
    Progress.findOne({ userId, courseId }),
    Course.findById(courseId).populate({ path: "modules", populate: { path: "materials", select: "title type duration" } }),
  ]);

  if (!course) throw new ApiError(404, "Course not found");

  const watchedSet = new Set((progress?.completedMaterials || []).map((m) => m.materialId.toString()));

  const moduleBreakdown = course.modules.map((mod) => {
    const completedInModule = mod.materials.filter((mat) => watchedSet.has(mat._id.toString())).length;
    return {
      moduleId: mod._id,
      moduleTitle: mod.title,
      totalMaterials: mod.materials.length,
      completedMaterials: completedInModule,
      modulePercent: mod.materials.length > 0 ? Math.round((completedInModule / mod.materials.length) * 100) : 0,
      materials: mod.materials.map((mat) => ({
        materialId: mat._id,
        title: mat.title,
        type: mat.type,
        duration: mat.duration,
        isCompleted: watchedSet.has(mat._id.toString()),
      })),
    };
  });

  return {
    courseId,
    courseTitle: course.title,
    completionPercent: progress?.completionPercent || 0,
    lastAccessedAt: progress?.lastAccessedAt || null,
    completedAt: progress?.completedAt || null,
    enrolledAt: enrollment.createdAt,
    moduleBreakdown,
  };
};

export const getCourseProgressService = async ({ courseId, query, user }) => {
  const { page = 1, limit = 20 } = query;
  const pageNum = Number(page);
  const limitNum = Number(limit);

  const course = await Course.findById(courseId).select("title");
  if (!course) throw new ApiError(404, "Course not found");

  if (user.role === "instructor") {
    const approved = await TeachingRequest.findOne({ courseId, instructorId: user.id, status: "approved" });
    if (!approved) throw new ApiError(403, "Access denied — you don't teach this course");
  }

  const [progressDocs, total] = await Promise.all([
    Progress.find({ courseId }).skip((pageNum - 1) * limitNum).limit(limitNum).sort({ completionPercent: -1 }),
    Progress.countDocuments({ courseId }),
  ]);

  if (progressDocs.length === 0) {
    return { students: [], total: 0, courseTitle: course.title };
  }

  const userIds = progressDocs.map((p) => p.userId);
  const placeholders = userIds.map((_, i) => `$${i + 1}`).join(", ");
  const usersResult = await pool.query(
    `SELECT id, full_name, email, avatar FROM users WHERE id IN (${placeholders})`,
    userIds
  );
  const usersMap = {};
  usersResult.rows.forEach((u) => (usersMap[u.id] = u));

  const totalMaterials = await getTotalMaterials(courseId);

  const enrolls = await Enrollment.find({ courseId, userId: { $in: userIds }, isActive: true }).select("userId enrollmentType");
  const typeMap = {};
  enrolls.forEach((e) => (typeMap[e.userId] = e.enrollmentType));

  const students = await Promise.all(
    progressDocs.map(async (p) => {
      const type = typeMap[p.userId];
      // Classroom and Live are attendance-based; show attendance rate as the
      // "completion" figure for those students.
      if (type === "classroom" || type === "live") {
        const att = type === "live"
          ? await getLiveAttendance(p.userId, courseId)
          : await getOfflineAttendance(p.userId, courseId);
        return {
          userId: p.userId,
          user: usersMap[p.userId] || { id: p.userId },
          mode: type,
          completionPercent: att?.rate || 0,
          completedMaterials: att?.present || 0,
          totalMaterials: att?.totalClasses || 0,
          lastAccessedAt: p.lastAccessedAt,
          completedAt: att?.eligible ? (p.completedAt || new Date()) : null,
        };
      }
      return {
        userId: p.userId,
        user: usersMap[p.userId] || { id: p.userId },
        mode: "self-paced",
        completionPercent: p.completionPercent,
        completedMaterials: new Set(p.completedMaterials.map((m) => m.materialId.toString())).size,
        totalMaterials,
        lastAccessedAt: p.lastAccessedAt,
        completedAt: p.completedAt,
      };
    })
  );

  const avgCompletion = students.length
    ? Math.round(students.reduce((s, x) => s + x.completionPercent, 0) / students.length)
    : 0;
  const fullyCompleted = students.filter((x) =>
    (x.mode === "classroom" || x.mode === "live") ? !!x.completedAt : x.completionPercent === 100
  ).length;

  return {
    courseTitle: course.title,
    totalMaterials,
    summary: {
      totalEnrolled: total,
      avgCompletionPercent: avgCompletion,
      fullyCompleted,
      inProgress: total - fullyCompleted,
    },
    students,
    page: pageNum,
    limit: limitNum,
    total,
  };
};

export const getStudentProgressService = async (userId) => {
  const progressDocs = await Progress.find({ userId }).populate("courseId", "title thumbnail category");
  return progressDocs.map((p) => ({
    courseId: p.courseId._id,
    courseTitle: p.courseId.title,
    courseThumbnail: p.courseId.thumbnail,
    category: p.courseId.category,
    completionPercent: p.completionPercent,
    lastAccessedAt: p.lastAccessedAt,
    completedAt: p.completedAt,
    enrolledAt: p.createdAt,
  }));
};

export const getPlatformProgressOverviewService = async () => {
  const enrollments = await Enrollment.find({ isActive: true }).select("userId courseId enrollmentType");
  if (enrollments.length === 0) return [];

  const courseIds = [...new Set(enrollments.map((e) => e.courseId.toString()))];

  const [courses, progressDocs] = await Promise.all([
    Course.find({ _id: { $in: courseIds } }).select("title"),
    Progress.find({ courseId: { $in: courseIds } }).select("userId courseId completionPercent"),
  ]);
  const titleMap = {};
  courses.forEach((c) => (titleMap[c._id.toString()] = c.title));
  const progMap = {};
  progressDocs.forEach((p) => (progMap[`${p.userId}:${p.courseId.toString()}`] = p.completionPercent));

  const byCourse = {};
  for (const e of enrollments) {
    const cid = e.courseId.toString();
    byCourse[cid] ||= { total: 0, sumPct: 0, completed: 0, neverStarted: 0 };

    let pct = 0;
    let done = false;
    if (e.enrollmentType === "classroom" || e.enrollmentType === "live") {
      const att = e.enrollmentType === "live"
        ? await getLiveAttendance(e.userId, e.courseId)
        : await getOfflineAttendance(e.userId, e.courseId);
      pct = att?.rate || 0;
      done = !!att?.eligible;
    } else {
      pct = progMap[`${e.userId}:${cid}`] || 0;
      done = pct === 100;
    }

    const acc = byCourse[cid];
    acc.total += 1;
    acc.sumPct += pct;
    if (done) acc.completed += 1;
    if (pct === 0) acc.neverStarted += 1;
  }

  return Object.entries(byCourse)
    .map(([cid, a]) => ({
      courseId: cid,
      courseTitle: titleMap[cid] || "—",
      totalStudents: a.total,
      avgCompletion: a.total ? Math.round(a.sumPct / a.total) : 0,
      completed: a.completed,
      neverStarted: a.neverStarted,
      completionRate: a.total ? Math.round((a.completed / a.total) * 100) : 0,
    }))
    .sort((x, y) => y.totalStudents - x.totalStudents);
};
