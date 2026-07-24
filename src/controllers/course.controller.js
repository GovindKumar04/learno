import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import {
  createCourseService,
  getAllCoursesService,
  getCourseCountsService,
  getCourseCategoriesService,
  getCourseByIdService,
  getCourseBySlugService,
  updateCourseService,
  deleteCourseService,
  listDeletedCoursesService,
  restoreCourseService,
  permanentlyDeleteCourseService,
  getTrendingCoursesService,
  getTopRatedCoursesService,
  getRecommendedCoursesService,
  getBecauseYouViewedService,
  recordCourseViewService,
  logSearchService,
} from "../services/course.service.js";

// Comma-separated query param → trimmed string array (e.g. ?categories=a,b).
const csv = (v) => (typeof v === "string" ? v.split(",").map((s) => s.trim()).filter(Boolean) : []);
const parseLimit = (v) => Math.min(Math.max(Number(v) || 12, 1), 24);

const createCourse = asyncHandler(async (req, res) => {
  const course = await createCourseService({ body: req.body, file: req.file, userId: req.user.id });
  return res.status(201).json(new ApiResponse(201, course, "Course created successfully"));
});

const getAllCourses = asyncHandler(async (req, res) => {
  const data = await getAllCoursesService({ query: req.query, user: req.user });
  return res.json(new ApiResponse(200, data));
});

// GET /courses/count — total / published / draft counts (admin-aware)
const getCourseCounts = asyncHandler(async (req, res) => {
  const counts = await getCourseCountsService({ user: req.user });
  return res.json(new ApiResponse(200, counts));
});

// GET /courses/categories — distinct categories (published only for non-admins)
const getCourseCategories = asyncHandler(async (req, res) => {
  const categories = await getCourseCategoriesService(req.user);
  return res.json(new ApiResponse(200, categories));
});

const getCourseById = asyncHandler(async (req, res) => {
  const course = await getCourseByIdService({ courseId: req.params.courseId, user: req.user });
  return res.json(new ApiResponse(200, course));
});

const getCourseBySlug = asyncHandler(async (req, res) => {
  const course = await getCourseBySlugService({ slug: req.params.slug, user: req.user });
  return res.json(new ApiResponse(200, course));
});

const updateCourse = asyncHandler(async (req, res) => {
  const course = await updateCourseService({ courseId: req.params.courseId, body: req.body, file: req.file });
  return res.json(new ApiResponse(200, course, "Course updated successfully"));
});

// Soft delete — move the course to the recycle bin (restorable for 60 days).
const deleteCourse = asyncHandler(async (req, res) => {
  await deleteCourseService({ courseId: req.params.courseId });
  return res.json(new ApiResponse(200, null, "Course moved to the recycle bin"));
});

// List the recycle bin (admin).
const getDeletedCourses = asyncHandler(async (req, res) => {
  const courses = await listDeletedCoursesService();
  return res.json(new ApiResponse(200, { courses }));
});

// Restore a binned course.
const restoreCourse = asyncHandler(async (req, res) => {
  const course = await restoreCourseService({ courseId: req.params.courseId });
  return res.json(new ApiResponse(200, course, "Course restored"));
});

// Permanently delete a binned course now (password-gated).
const permanentlyDeleteCourse = asyncHandler(async (req, res) => {
  await permanentlyDeleteCourseService({ courseId: req.params.courseId, password: req.body?.password, adminId: req.user.id });
  return res.json(new ApiResponse(200, null, "Course permanently deleted"));
});

// ─── Home-page discovery ────────────────────────────────────────────────────
// All return the same shape as the catalog list: { data: { courses } }.

const getTrending = asyncHandler(async (req, res) => {
  const courses = await getTrendingCoursesService({ limit: parseLimit(req.query.limit) });
  return res.json(new ApiResponse(200, { courses }));
});

const getTopRated = asyncHandler(async (req, res) => {
  const courses = await getTopRatedCoursesService({ limit: parseLimit(req.query.limit) });
  return res.json(new ApiResponse(200, { courses }));
});

const getRecommended = asyncHandler(async (req, res) => {
  const courses = await getRecommendedCoursesService({
    user: req.user,
    categories: csv(req.query.categories),
    excludeIds: csv(req.query.exclude),
    limit: parseLimit(req.query.limit),
  });
  return res.json(new ApiResponse(200, { courses }));
});

const getBecauseYouViewed = asyncHandler(async (req, res) => {
  const courses = await getBecauseYouViewedService({
    user: req.user,
    categories: csv(req.query.categories),
    excludeIds: csv(req.query.exclude),
    limit: parseLimit(req.query.limit),
  });
  return res.json(new ApiResponse(200, { courses }));
});

const recordCourseView = asyncHandler(async (req, res) => {
  await recordCourseViewService({ courseId: req.params.courseId, user: req.user });
  return res.json(new ApiResponse(200, null, "View recorded"));
});

const logSearch = asyncHandler(async (req, res) => {
  await logSearchService({ q: req.body?.q, user: req.user });
  return res.json(new ApiResponse(200, null, "Search logged"));
});

export {
  createCourse, getAllCourses, getCourseCounts, getCourseCategories, getCourseById, getCourseBySlug, updateCourse, deleteCourse,
  getDeletedCourses, restoreCourse, permanentlyDeleteCourse,
  getTrending, getTopRated, getRecommended, getBecauseYouViewed, recordCourseView, logSearch,
};
