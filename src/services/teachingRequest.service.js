import { TeachingRequest } from "../models/teachingRequest.model.js";
import { Course } from "../models/course.model.js";
import { Batch } from "../models/batch.model.js";
import { OnlineClass } from "../models/onlineClass.model.js";
import { ApiError } from "../utils/ApiError.js";
import { verifyAdminPassword, assertNoDependents } from "../utils/deleteGuard.util.js";
import { isUuid } from "../utils/id.util.js";
import pool from "../config/db.js";

// After withdrawing their own request, an instructor must wait this long before
// they can apply to teach the same course again.
export const WITHDRAW_HOLD_DAYS = 30;
const holdUntilFrom = (withdrawnAt) =>
  new Date(new Date(withdrawnAt).getTime() + WITHDRAW_HOLD_DAYS * 24 * 60 * 60 * 1000);

const TEACHING_MODES = ["self-paced", "classroom", "live"];
const MODE_LABELS = { "self-paced": "self-paced", classroom: "classroom", live: "live" };

// Instructor requests to teach a course in a specific mode (re-opens a previously
// rejected/withdrawn request for that same mode).
// Returns { request, reSubmitted } so the controller can pick 200 vs 201.
export const createTeachingRequestService = async ({ instructorId, courseId, mode = "classroom", message = "" }) => {
  if (!courseId) throw new ApiError(400, "courseId is required");
  if (!TEACHING_MODES.includes(mode)) {
    throw new ApiError(400, `mode must be one of: ${TEACHING_MODES.join(", ")}`);
  }

  const course = await Course.findById(courseId).select("title modes");
  if (!course) throw new ApiError(404, "Course not found");
  if (Array.isArray(course.modes) && !course.modes.includes(mode)) {
    throw new ApiError(400, `This course is not offered in ${MODE_LABELS[mode]} mode`);
  }

  const existing = await TeachingRequest.findOne({ instructorId, courseId, mode });
  if (existing) {
    if (existing.status === "pending") throw new ApiError(409, `You already have a pending ${MODE_LABELS[mode]} request for this course`);
    if (existing.status === "approved") throw new ApiError(409, `You are already approved to teach this course in ${MODE_LABELS[mode]} mode`);
    if (existing.status === "withdrawn" && existing.withdrawnAt) {
      const holdUntil = holdUntilFrom(existing.withdrawnAt);
      if (Date.now() < holdUntil.getTime()) {
        const until = holdUntil.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
        throw new ApiError(403, `You withdrew this request recently. You can apply to teach this course in ${MODE_LABELS[mode]} mode again on ${until}.`);
      }
    }
    // Previously rejected, or withdrawn with the hold elapsed → re-open
    existing.status = "pending";
    existing.message = message;
    existing.reviewedBy = null;
    existing.reviewedAt = null;
    existing.withdrawnAt = null;
    await existing.save();
    return { request: existing, reSubmitted: true };
  }

  const request = await TeachingRequest.create({ instructorId, courseId, mode, message });
  return { request, reSubmitted: false };
};

export const getMyTeachingRequestsService = async (instructorId) =>
  TeachingRequest.find({ instructorId })
    .populate("courseId", "title thumbnail category")
    .sort({ createdAt: -1 });

export const getAllTeachingRequestsService = async ({ page = 1, limit = 20, status }) => {
  const pageNum = Number(page);
  const limitNum = Number(limit);

  const filter = {};
  if (status) filter.status = status;

  const [requests, total] = await Promise.all([
    TeachingRequest.find(filter)
      .populate("courseId", "title thumbnail category level")
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum)
      .sort({ createdAt: -1 }),
    TeachingRequest.countDocuments(filter),
  ]);

  if (requests.length === 0) return { requests: [], total: 0, page: pageNum, limit: limitNum };

  const instructorIds = [...new Set(requests.map((r) => r.instructorId).filter(isUuid))];
  const placeholders = instructorIds.length ? instructorIds.map((_, i) => `$${i + 1}`).join(", ") : "NULL";
  const usersResult = await pool.query(
    `SELECT id, full_name, email, phone FROM users WHERE id IN (${placeholders})`,
    instructorIds
  );
  const usersMap = {};
  usersResult.rows.forEach((u) => (usersMap[u.id] = u));

  const data = requests.map((r) => ({
    id: r._id,
    status: r.status,
    message: r.message,
    mode: r.mode,
    createdAt: r.createdAt,
    reviewedAt: r.reviewedAt,
    withdrawnAt: r.withdrawnAt,
    instructor: usersMap[r.instructorId] || { id: r.instructorId },
    course: r.courseId,
  }));

  return { requests: data, total, page: pageNum, limit: limitNum };
};

export const updateTeachingRequestStatusService = async ({ id, status, reviewerId }) => {
  if (!["approved", "rejected"].includes(status)) {
    throw new ApiError(400, "status must be 'approved' or 'rejected'");
  }
  const request = await TeachingRequest.findById(id);
  if (!request) throw new ApiError(404, "Teaching request not found");

  request.status = status;
  request.reviewedBy = reviewerId;
  request.reviewedAt = new Date();
  await request.save();
  return request;
};

// Instructors "withdraw" their own request (soft delete + start the re-apply hold);
// admins hard-delete the record entirely.
export const deleteTeachingRequestService = async ({ id, user, password }) => {
  const request = await TeachingRequest.findById(id);
  if (!request) throw new ApiError(404, "Teaching request not found");

  if (user.role !== "admin" && request.instructorId !== user.id) {
    throw new ApiError(403, "You can only withdraw your own requests");
  }

  if (user.role === "admin") {
    await verifyAdminPassword(user.id, password);
    // Don't strip an approved instructor's access while they still run batches /
    // live classes for the course — those must be reassigned/removed first.
    // Scope the check to the mode being revoked: classroom → batches, live →
    // online classes. (self-paced has no live/in-person dependents.)
    if (request.status === "approved") {
      const dependents = [];
      if (request.mode === "classroom") {
        dependents.push({
          label: "batch(es) run by this instructor",
          count: await Batch.countDocuments({ courseId: request.courseId, instructorId: request.instructorId }),
        });
      }
      if (request.mode === "live") {
        dependents.push({
          label: "live class(es) run by this instructor",
          count: await OnlineClass.countDocuments({ courseId: request.courseId, instructorId: request.instructorId }),
        });
      }
      if (dependents.length) assertNoDependents("teaching approval", dependents);
    }
    await request.deleteOne();
    return { deleted: true };
  }

  request.status = "withdrawn";
  request.withdrawnAt = new Date();
  request.reviewedBy = null;
  request.reviewedAt = null;
  await request.save();
  return { withdrawn: true, holdUntil: holdUntilFrom(request.withdrawnAt) };
};
