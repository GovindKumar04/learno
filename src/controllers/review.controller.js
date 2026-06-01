import { Course } from "../models/course.model.js";
import { Enrollment } from "../models/enrollment.model.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import pool from "../config/db.js";

const recalcRating = (course) => {
  if (course.reviews.length === 0) {
    course.averageRating = 0;
    course.totalReviews = 0;
    return;
  }
  const sum = course.reviews.reduce((acc, r) => acc + r.rating, 0);
  course.averageRating = Math.round((sum / course.reviews.length) * 10) / 10;
  course.totalReviews = course.reviews.length;
};

const fetchUserMap = async (userIds) => {
  if (!userIds.length) return {};
  const placeholders = userIds.map((_, i) => `$${i + 1}`).join(", ");
  const result = await pool.query(
    `SELECT id::text AS id, full_name, avatar FROM users WHERE id::text IN (${placeholders})`,
    userIds
  );
  const map = {};
  result.rows.forEach((u) => (map[u.id] = u));
  return map;
};

// POST /courses/:courseId/reviews
// Enrolled student adds or updates their review (one review per user per course)
const addOrUpdateReview = asyncHandler(async (req, res) => {
  const { courseId } = req.params;
  const { rating, comment } = req.body;
  const userId = String(req.user.id);

  if (!rating || rating < 1 || rating > 5) {
    throw new ApiError(400, "Rating must be between 1 and 5");
  }

  const enrollment = await Enrollment.findOne({ userId, courseId, isActive: true });
  if (!enrollment) {
    throw new ApiError(403, "You must be enrolled in this course to leave a review");
  }

  const course = await Course.findById(courseId);
  if (!course) throw new ApiError(404, "Course not found");

  const existingIndex = course.reviews.findIndex((r) => r.userId === userId);

  if (existingIndex !== -1) {
    course.reviews[existingIndex].rating = rating;
    course.reviews[existingIndex].comment = comment || "";
    course.reviews[existingIndex].createdAt = new Date();
  } else {
    course.reviews.push({ userId, rating, comment: comment || "" });
  }

  recalcRating(course);
  await course.save();

  return res.status(200).json(
    new ApiResponse(
      200,
      { averageRating: course.averageRating, totalReviews: course.totalReviews },
      existingIndex !== -1 ? "Review updated" : "Review added"
    )
  );
});

// DELETE /courses/:courseId/reviews
// Student deletes their own review; admin can pass ?userId= to delete any
const deleteReview = asyncHandler(async (req, res) => {
  const { courseId } = req.params;
  const targetUserId =
    req.user.role === "admin" && req.query.userId
      ? String(req.query.userId)
      : String(req.user.id);

  const course = await Course.findById(courseId);
  if (!course) throw new ApiError(404, "Course not found");

  const index = course.reviews.findIndex((r) => r.userId === targetUserId);
  if (index === -1) throw new ApiError(404, "Review not found");

  course.reviews.splice(index, 1);
  recalcRating(course);
  await course.save();

  return res.json(new ApiResponse(200, null, "Review deleted"));
});

// GET /courses/:courseId/reviews
// All logged-in users can see reviews
const getReviews = asyncHandler(async (req, res) => {
  const { courseId } = req.params;
  const { page = 1, limit = 10 } = req.query;
  const pageNum = Number(page);
  const limitNum = Number(limit);

  const course = await Course.findById(courseId).select(
    "reviews averageRating totalReviews title"
  );
  if (!course) throw new ApiError(404, "Course not found");

  const start = (pageNum - 1) * limitNum;
  const paginated = course.reviews.slice(start, start + limitNum);

  const usersMap = await fetchUserMap(paginated.map((r) => r.userId));

  const reviews = paginated.map((r) => ({
    ...r.toObject(),
    user: usersMap[r.userId] || { id: r.userId },
  }));

  return res.json(
    new ApiResponse(200, {
      reviews,
      total: course.reviews.length,
      averageRating: course.averageRating,
      page: pageNum,
      limit: limitNum,
    })
  );
});

// GET /courses/:courseId/reviews/testimonials
// Featured reviews only — visible to all (including guests via optionalAuth)
const getTestimonials = asyncHandler(async (req, res) => {
  const { courseId } = req.params;

  const course = await Course.findById(courseId).select(
    "reviews averageRating totalReviews title"
  );
  if (!course) throw new ApiError(404, "Course not found");

  const featured = course.reviews.filter((r) => r.isFeatured);
  const usersMap = await fetchUserMap(featured.map((r) => r.userId));

  const testimonials = featured.map((r) => ({
    ...r.toObject(),
    user: usersMap[r.userId] || { id: r.userId },
  }));

  return res.json(new ApiResponse(200, testimonials));
});

// PATCH /courses/:courseId/reviews/featured
// Admin toggles a review's featured/testimonial status
// Body: { userId, isFeatured? }
const toggleFeatured = asyncHandler(async (req, res) => {
  const { courseId } = req.params;
  const { userId: targetUserId, isFeatured } = req.body;

  if (!targetUserId) throw new ApiError(400, "userId is required");

  const course = await Course.findById(courseId);
  if (!course) throw new ApiError(404, "Course not found");

  const review = course.reviews.find((r) => r.userId === String(targetUserId));
  if (!review) throw new ApiError(404, "Review not found");

  review.isFeatured = isFeatured !== undefined ? isFeatured : !review.isFeatured;
  await course.save();

  return res.json(
    new ApiResponse(
      200,
      review,
      `Review ${review.isFeatured ? "marked as testimonial" : "removed from testimonials"}`
    )
  );
});

export { addOrUpdateReview, deleteReview, getReviews, getTestimonials, toggleFeatured };
