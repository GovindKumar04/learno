import { Scholarship } from "../models/scholarship.model.js";
import { Course } from "../models/course.model.js";
import { ApiError } from "../utils/ApiError.js";
import { buildUserMap } from "../utils/userQuery.util.js";

const VALID_TRACKS = ["merit", "need", "women", "early"];

// Student applies for a scholarship on a specific course
export const applyForScholarshipService = async ({ userId, track, courseId, statement, income = "" }) => {
  if (!track || !VALID_TRACKS.includes(track)) throw new ApiError(400, "A valid scholarship track is required");
  if (!courseId) throw new ApiError(400, "Please select a course");
  if (!statement || !statement.trim()) throw new ApiError(400, "A statement of purpose is required");

  const course = await Course.findById(courseId).select("title isPublished");
  if (!course) throw new ApiError(404, "Course not found");

  const existing = await Scholarship.findOne({
    userId,
    courseId,
    status: { $in: ["pending", "under_review", "approved"] },
  });
  if (existing) {
    throw new ApiError(
      409,
      existing.status === "approved"
        ? "You already have an approved scholarship for this course"
        : "You already have a pending application for this course"
    );
  }

  return Scholarship.create({ userId, track, courseId, statement: statement.trim(), income });
};

export const getMyApplicationsService = async (userId) =>
  Scholarship.find({ userId })
    .populate("courseId", "title thumbnail category slug")
    .sort({ createdAt: -1 });

// All applications with filters + pagination + applicant info from PostgreSQL
export const getAllApplicationsService = async ({ page = 1, limit = 20, status, track, search }) => {
  const pageNum = Number(page);
  const limitNum = Number(limit);

  const filter = {};
  if (status) filter.status = status;
  if (track) filter.track = track;

  const [applications, total] = await Promise.all([
    Scholarship.find(filter)
      .populate("courseId", "title thumbnail category")
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum)
      .sort({ createdAt: -1 }),
    Scholarship.countDocuments(filter),
  ]);

  let result = applications;
  if (applications.length) {
    const userIds = [...new Set(applications.map((a) => a.userId))];
    const usersMap = await buildUserMap(userIds, "full_name email phone");

    result = applications.map((a) => ({ ...a.toObject(), applicant: usersMap[a.userId] || { id: a.userId } }));

    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (a) =>
          a.applicant.full_name?.toLowerCase().includes(q) ||
          a.applicant.email?.toLowerCase().includes(q)
      );
    }
  }

  return { applications: result, total, page: pageNum, limit: limitNum };
};

export const getScholarshipStatsService = async () => {
  const byStatus = await Scholarship.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]);
  const stats = { pending: 0, under_review: 0, approved: 0, rejected: 0, total: 0 };
  byStatus.forEach((s) => {
    stats[s._id] = s.count;
    stats.total += s.count;
  });
  return stats;
};

// Approve / reject an application, optionally setting a discount percent
export const reviewApplicationService = async ({ id, status, discountPercent, adminNote = "", reviewerId }) => {
  if (!["under_review", "approved", "rejected"].includes(status)) {
    throw new ApiError(400, "status must be under_review, approved or rejected");
  }

  const application = await Scholarship.findById(id);
  if (!application) throw new ApiError(404, "Application not found");

  if (status === "approved") {
    const pct = Number(discountPercent);
    if (!pct || pct <= 0 || pct > 100) {
      throw new ApiError(400, "Approved scholarships need a discountPercent between 1 and 100");
    }
    application.discountPercent = pct;
  } else {
    application.discountPercent = 0;
  }

  application.status = status;
  application.adminNote = adminNote;
  application.reviewedBy = reviewerId;
  application.reviewedAt = new Date();
  await application.save();
  return application;
};
