import { Course } from "../models/course.model.js";
import { Enrollment } from "../models/enrollment.model.js";
import { ApiError } from "../utils/ApiError.js";
import { buildUserMap } from "../utils/userQuery.util.js";

// Public rating reflects only APPROVED reviews — a pending review must never
// move the visible average/count before an admin has approved it.
const isApproved = (r) => (r.status || "approved") === "approved";

const recalcRating = (course) => {
  const approved = course.reviews.filter(isApproved);
  if (approved.length === 0) {
    course.averageRating = 0;
    course.totalReviews = 0;
    return;
  }
  const sum = approved.reduce((acc, r) => acc + r.rating, 0);
  course.averageRating = Math.round((sum / approved.length) * 10) / 10;
  course.totalReviews = approved.length;
};

const fetchUserMap = async (userIds) => buildUserMap(userIds, "full_name avatar");

// Enrolled student adds or updates their review (one per user per course)
export const addOrUpdateReviewService = async ({ courseId, userId, rating, comment }) => {
  if (!rating || rating < 1 || rating > 5) throw new ApiError(400, "Rating must be between 1 and 5");

  const enrollment = await Enrollment.findOne({ userId, courseId, isActive: true });
  if (!enrollment) throw new ApiError(403, "You must be enrolled in this course to leave a review");

  const course = await Course.findById(courseId);
  if (!course) throw new ApiError(404, "Course not found");

  const existingIndex = course.reviews.findIndex((r) => r.userId === userId);
  if (existingIndex !== -1) {
    // Editing resubmits the review for moderation: it stays visible to its
    // author but drops back to "pending" for everyone else until re-approved.
    course.reviews[existingIndex].rating = rating;
    course.reviews[existingIndex].comment = comment || "";
    course.reviews[existingIndex].createdAt = new Date();
    course.reviews[existingIndex].status = "pending";
    course.reviews[existingIndex].isFeatured = false;
  } else {
    course.reviews.push({ userId, rating, comment: comment || "", status: "pending" });
  }

  recalcRating(course);
  await course.save();

  return {
    updated: existingIndex !== -1,
    status: "pending",
    averageRating: course.averageRating,
    totalReviews: course.totalReviews,
  };
};

export const deleteReviewService = async ({ courseId, targetUserId }) => {
  const course = await Course.findById(courseId);
  if (!course) throw new ApiError(404, "Course not found");

  const index = course.reviews.findIndex((r) => r.userId === targetUserId);
  if (index === -1) throw new ApiError(404, "Review not found");

  course.reviews.splice(index, 1);
  recalcRating(course);
  await course.save();
};

// Visibility rules:
//   • everyone sees APPROVED reviews
//   • a signed-in author additionally sees their own review (pending/rejected)
//   • an admin sees everything (so they can moderate)
// `requesterId` / `isAdmin` come from optionalAuth on the route.
export const getReviewsService = async ({ courseId, page = 1, limit = 10, requesterId = null, isAdmin = false }) => {
  const pageNum = Number(page);
  const limitNum = Number(limit);

  const course = await Course.findById(courseId).select("reviews averageRating totalReviews title");
  if (!course) throw new ApiError(404, "Course not found");

  const reqId = requesterId ? String(requesterId) : null;
  const visible = course.reviews.filter((r) => {
    if (isAdmin) return true;
    if (isApproved(r)) return true;
    return reqId && r.userId === reqId; // own pending/rejected review
  });

  // Show the requester's own review first, then newest approved reviews.
  visible.sort((a, b) => {
    if (reqId) {
      if (a.userId === reqId) return -1;
      if (b.userId === reqId) return 1;
    }
    return new Date(b.createdAt) - new Date(a.createdAt);
  });

  const start = (pageNum - 1) * limitNum;
  const paginated = visible.slice(start, start + limitNum);
  const usersMap = await fetchUserMap(paginated.map((r) => r.userId));

  const reviews = paginated.map((r) => ({
    ...r.toObject(),
    status: r.status || "approved",
    user: usersMap[r.userId] || { id: r.userId },
  }));

  return {
    reviews,
    total: visible.length,
    averageRating: course.averageRating,
    page: pageNum,
    limit: limitNum,
  };
};

export const getTestimonialsService = async ({ courseId }) => {
  const course = await Course.findById(courseId).select("reviews averageRating totalReviews title");
  if (!course) throw new ApiError(404, "Course not found");

  const featured = course.reviews.filter((r) => r.isFeatured);
  const usersMap = await fetchUserMap(featured.map((r) => r.userId));

  return featured.map((r) => ({ ...r.toObject(), user: usersMap[r.userId] || { id: r.userId } }));
};

export const toggleFeaturedService = async ({ courseId, targetUserId, isFeatured }) => {
  if (!targetUserId) throw new ApiError(400, "userId is required");

  const course = await Course.findById(courseId);
  if (!course) throw new ApiError(404, "Course not found");

  const review = course.reviews.find((r) => r.userId === String(targetUserId));
  if (!review) throw new ApiError(404, "Review not found");

  // Only an approved review can be promoted to a testimonial.
  if (isFeatured && !isApproved(review)) {
    throw new ApiError(400, "Approve the review before featuring it as a testimonial");
  }

  review.isFeatured = isFeatured !== undefined ? isFeatured : !review.isFeatured;
  await course.save();
  return review;
};

// Admin approves / rejects a review. Approving makes it public and recomputes
// the rating; rejecting (or un-approving) hides it from everyone but the author.
export const moderateReviewService = async ({ courseId, targetUserId, status }) => {
  if (!targetUserId) throw new ApiError(400, "userId is required");
  if (!["approved", "rejected", "pending"].includes(status)) {
    throw new ApiError(400, "status must be approved, rejected or pending");
  }

  const course = await Course.findById(courseId);
  if (!course) throw new ApiError(404, "Course not found");

  const review = course.reviews.find((r) => r.userId === String(targetUserId));
  if (!review) throw new ApiError(404, "Review not found");

  review.status = status;
  if (status !== "approved") review.isFeatured = false; // can't feature a non-approved review

  recalcRating(course);
  await course.save();
  return review;
};

// Admin moderation queue: every pending review across all courses, newest first,
// hydrated with the reviewer's name/avatar and the course title/slug.
export const getPendingReviewsService = async ({ status = "pending" } = {}) => {
  const courses = await Course.find({ "reviews.status": status })
    .select("title slug thumbnail reviews");

  const rows = [];
  for (const course of courses) {
    for (const r of course.reviews) {
      if ((r.status || "approved") !== status) continue;
      rows.push({
        courseId: String(course._id),
        courseTitle: course.title,
        courseSlug: course.slug,
        courseThumbnail: course.thumbnail,
        userId: r.userId,
        rating: r.rating,
        comment: r.comment,
        status: r.status,
        createdAt: r.createdAt,
      });
    }
  }

  rows.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const usersMap = await fetchUserMap(rows.map((r) => r.userId));
  return rows.map((r) => ({ ...r, user: usersMap[r.userId] || { id: r.userId } }));
};
