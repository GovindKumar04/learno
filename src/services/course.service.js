import mongoose from "mongoose";
import { Course } from "../models/course.model.js";
import { UserActivity } from "../models/userActivity.model.js";
import { Module } from "../models/module.model.js";
import { Material } from "../models/material.model.js";
import { Enrollment } from "../models/enrollment.model.js";
import { Progress } from "../models/progress.model.js";
import { Batch } from "../models/batch.model.js";
import { OnlineClass } from "../models/onlineClass.model.js";
import { Certificate } from "../models/certificate.model.js";
import { uploadToCloudinary, deleteFromCloudinary } from "../utils/cloudinary.util.js";
import { ApiError } from "../utils/ApiError.js";
import { hasOnlineCourseAccess, stripMaterialUrls } from "../utils/courseAccess.js";
import { verifyAdminPassword, assertNoDependents, escapeRegex } from "../utils/deleteGuard.util.js";
import { getOrSet, nsKey, bumpNs } from "../utils/cache.js";

// Cache namespace for public catalog reads (list + categories). Any course
// create/update/delete bumps it, invalidating every cached variant at once.
const COURSES_NS = "courses";

// How many cards a single home-page discovery carousel shows.
const DISCOVERY_LIMIT = 12;

// Named sort orders shared by the catalog list and the home-page carousels.
const SORT_MAP = {
  popular:  { totalStudentsEnrolled: -1, createdAt: -1 },
  rating:   { averageRating: -1, totalReviews: -1 },
  trending: { viewCount: -1, totalStudentsEnrolled: -1 },
  newest:   { createdAt: -1 },
};
const resolveSort = (s) => SORT_MAP[s] || SORT_MAP.newest;

// Keep only well-formed ObjectId strings so a stray client value can't crash a cast.
const toValidIds = (ids) => (ids || []).filter((id) => mongoose.isValidObjectId(id));

// Shared published-course fetch for the discovery carousels. Lighter projection
// than the catalog list (no modules/reviews) since cards only need summary data.
const fetchPublishedCourses = async ({ sort = "newest", limit = DISCOVERY_LIMIT, categories, excludeIds } = {}) => {
  const filter = { isPublished: true };
  const cats = (categories || []).filter(Boolean);
  if (cats.length) filter.category = { $in: cats };
  const excl = toValidIds(excludeIds);
  if (excl.length) filter._id = { $nin: excl };
  return Course.find(filter).select("-modules -reviews").limit(limit).sort(resolveSort(sort));
};

export const createCourseService = async ({ body, file, userId }) => {
  const { title, description, category, level, price, priceOnline, priceOffline, priceLive, discountPercent, modes, isPublished, totalClasses, totalLiveClasses } = body;
  if (!title || !description || !category) {
    throw new ApiError(400, "title, description, and category are required");
  }

  // modes may arrive as a JSON string (FormData), an array, or a single value.
  let parsedModes;
  if (modes !== undefined) {
    try { parsedModes = typeof modes === "string" ? JSON.parse(modes) : modes; }
    catch { parsedModes = [].concat(modes); }
  }

  const willPublish = isPublished === true || isPublished === "true";
  if (willPublish) {
    const hasPrice = Number(price) > 0 || Number(priceOnline) > 0 || Number(priceOffline) > 0 || Number(priceLive) > 0;
    if (!hasPrice) throw new ApiError(400, "Assign a price before publishing this course");
  }

  let thumbnail, thumbnailPublicId;
  if (file) {
    const uploaded = await uploadToCloudinary(file.path, file.mimetype, "course-thumbnails");
    thumbnail = uploaded.url;
    thumbnailPublicId = uploaded.publicId;
  }

  const created = await Course.create({
    title, description, category, level,
    price: price || 0,
    priceOnline: priceOnline || 0,
    priceOffline: priceOffline || 0,
    priceLive: priceLive || 0,
    discountPercent: Math.min(Math.max(Number(discountPercent) || 0, 0), 90),
    totalClasses: Number(totalClasses) || 0,
    totalLiveClasses: Number(totalLiveClasses) || 0,
    ...(parsedModes && { modes: parsedModes }),
    isPublished: willPublish,
    thumbnail, thumbnailPublicId,
    createdBy: userId,
  });
  await bumpNs(COURSES_NS);
  return created;
};

export const getAllCoursesService = async ({ query, user }) => {
  const pageNum = Number(query.page) || 1;
  const limitNum = Number(query.limit) || 10;
  const { search, category, level, sort } = query;
  const isAdmin = user && user.role === "admin";

  const runQuery = async () => {
    const filter = {};
    if (!isAdmin) filter.isPublished = true;
    if (category && category.trim()) filter.category = { $regex: escapeRegex(category.trim()), $options: "i" };
    if (level && level.trim()) filter.level = level.trim();
    if (search && search.trim()) {
      const regex = { $regex: escapeRegex(search.trim()), $options: "i" };
      filter.$or = [{ title: regex }, { category: regex }, { description: regex }];
    }

    const [courses, total] = await Promise.all([
      Course.find(filter).skip((pageNum - 1) * limitNum).limit(limitNum).select("-modules").sort(resolveSort(sort)),
      Course.countDocuments(filter),
    ]);

    return { courses, total, page: pageNum, limit: limitNum };
  };

  // Admins see drafts and edit constantly → never cache. Public catalog is
  // identical for everyone, so cache it (5 min) keyed by the query variant.
  if (isAdmin) return runQuery();
  const key = await nsKey(COURSES_NS, `list:${pageNum}:${limitNum}:${category || ""}:${level || ""}:${search || ""}:${sort || ""}`);
  return getOrSet(key, 300, runQuery);
};

export const getCourseCategoriesService = async (user) => {
  const isAdmin = user && user.role === "admin";
  const runQuery = async () => {
    const filter = {};
    if (!isAdmin) filter.isPublished = true;
    const categories = await Course.distinct("category", filter);
    return categories.filter(Boolean).sort();
  };

  if (isAdmin) return runQuery();
  const key = await nsKey(COURSES_NS, "categories");
  return getOrSet(key, 1800, runQuery);
};

const loadCourseForViewer = async (course, user) => {
  if (!course) throw new ApiError(404, "Course not found");
  if (!course.isPublished && user?.role !== "admin") {
    throw new ApiError(403, "This course is not published yet");
  }
  const obj = course.toObject();
  if (!(await hasOnlineCourseAccess(user, course._id))) stripMaterialUrls(obj.modules);
  return obj;
};

export const getCourseByIdService = async ({ courseId, user }) => {
  const course = await Course.findById(courseId).populate({ path: "modules", populate: { path: "materials" } });
  return loadCourseForViewer(course, user);
};

export const getCourseBySlugService = async ({ slug, user }) => {
  const course = await Course.findOne({ slug }).populate({
    path: "modules",
    options: { sort: { order: 1 } },
    populate: { path: "materials" },
  });
  return loadCourseForViewer(course, user);
};

export const updateCourseService = async ({ courseId, body, file }) => {
  const course = await Course.findById(courseId);
  if (!course) throw new ApiError(404, "Course not found");

  const scalarFields = [
    "title", "description", "category", "level", "price",
    "isPublished", "language", "duration", "priceOnline", "priceOffline", "priceLive", "discountPercent",
    "totalClasses", "totalLiveClasses", "slug", "tag", "subtitle", "tagline", "heroImg",
  ];
  scalarFields.forEach((field) => {
    if (body[field] !== undefined) course[field] = body[field];
  });

  const jsonArrayFields = [
    "benefits", "prerequisites", "targetAudience", "demandReasons",
    "highlights", "learnPoints", "faqs", "modes",
  ];
  jsonArrayFields.forEach((field) => {
    if (body[field] !== undefined) {
      try { course[field] = JSON.parse(body[field]); } catch { /* ignore bad JSON */ }
    }
  });

  const jsonObjectFields = ["whyChooseUs", "industry"];
  jsonObjectFields.forEach((field) => {
    if (body[field] !== undefined) {
      try { course[field] = JSON.parse(body[field]); } catch { /* ignore */ }
    }
  });

  if (file) {
    if (course.thumbnailPublicId) await deleteFromCloudinary(course.thumbnailPublicId, "image");
    const uploaded = await uploadToCloudinary(file.path, file.mimetype, "course-thumbnails");
    course.thumbnail = uploaded.url;
    course.thumbnailPublicId = uploaded.publicId;
  }

  if (course.isPublished) {
    const hasPrice = course.price > 0 || course.priceOnline > 0 || course.priceOffline > 0;
    if (!hasPrice) throw new ApiError(400, "Assign a price before publishing this course");
  }

  await course.save();
  await bumpNs(COURSES_NS);
  return course;
};

export const deleteCourseService = async ({ courseId, password, adminId }) => {
  await verifyAdminPassword(adminId, password);

  const course = await Course.findById(courseId);
  if (!course) throw new ApiError(404, "Course not found");

  // Refuse to delete while structural records still depend on this course — the
  // admin must remove those first (no silent cascade).
  const [modules, batches, onlineClasses, activeEnrollments, certificates] = await Promise.all([
    Module.countDocuments({ course: courseId }),
    Batch.countDocuments({ courseId }),
    OnlineClass.countDocuments({ courseId }),
    Enrollment.countDocuments({ courseId, isActive: true }),
    Certificate.countDocuments({ courseId }),
  ]);
  assertNoDependents("course", [
    { label: "module(s)", count: modules },
    { label: "batch(es)", count: batches },
    { label: "live class(es)", count: onlineClasses },
    { label: "active enrollment(s)", count: activeEnrollments },
    { label: "issued certificate(s)", count: certificates },
  ]);

  // Safe to remove: only historical leftovers (already-unenrolled rows + their
  // progress) remain, plus the thumbnail asset.
  if (course.thumbnailPublicId) await deleteFromCloudinary(course.thumbnailPublicId, "image");
  await Promise.all([
    Enrollment.deleteMany({ courseId }),
    Progress.deleteMany({ courseId }),
  ]);

  await Course.findByIdAndDelete(courseId);
  await bumpNs(COURSES_NS);
};

// ─── Home-page discovery ────────────────────────────────────────────────────

// Trending = most viewed (with enrollments as a tie-breaker). Global + cached.
export const getTrendingCoursesService = async ({ limit = DISCOVERY_LIMIT } = {}) => {
  const key = await nsKey(COURSES_NS, `trending:${limit}`);
  return getOrSet(key, 300, () => fetchPublishedCourses({ sort: "trending", limit }));
};

// Highest-rated courses. Global + cached.
export const getTopRatedCoursesService = async ({ limit = DISCOVERY_LIMIT } = {}) => {
  const key = await nsKey(COURSES_NS, `toprated:${limit}`);
  return getOrSet(key, 300, () => fetchPublishedCourses({ sort: "rating", limit }));
};

// Pull the categories a user has engaged with (and the courses to exclude) from
// their stored activity, merged with any hints the client passes for anon users.
const gatherSignal = async ({ user, categories = [], excludeIds = [] }) => {
  const cats = [...categories];
  const excl = [...excludeIds];
  if (user?.id) {
    const act = await UserActivity.findOne({ userId: user.id }).lean();
    if (act?.recentViews?.length) {
      for (const v of act.recentViews) {
        if (v.category) cats.push(v.category);
        if (v.courseId) excl.push(String(v.courseId));
      }
    }
  }
  return { cats: [...new Set(cats.filter(Boolean))], excl: [...new Set(excl)] };
};

// Recommended = popular courses in the categories the user engaged with, padded
// with globally-popular courses so the carousel is never short. Not cached
// because it is personalised; anonymous callers pass their localStorage hints.
export const getRecommendedCoursesService = async ({ user, categories, excludeIds, limit = DISCOVERY_LIMIT }) => {
  const { cats, excl } = await gatherSignal({ user, categories, excludeIds });

  let result = [];
  if (cats.length) {
    result = await fetchPublishedCourses({ sort: "popular", limit, categories: cats, excludeIds: excl });
  }
  if (result.length < limit) {
    const have = new Set(result.map((c) => String(c._id)));
    const padExclude = [...new Set([...excl, ...have])];
    const extra = await fetchPublishedCourses({ sort: "popular", limit: limit - result.length, excludeIds: padExclude });
    result = [...result, ...extra];
  }
  return result;
};

// "Because you viewed" = popular courses sharing categories with what the user
// recently viewed, excluding the viewed courses themselves. Empty when there's
// no view history (the client then hides the section).
export const getBecauseYouViewedService = async ({ user, categories, excludeIds, limit = DISCOVERY_LIMIT }) => {
  const { cats, excl } = await gatherSignal({ user, categories, excludeIds });
  if (!cats.length) return [];
  return fetchPublishedCourses({ sort: "popular", limit, categories: cats, excludeIds: excl });
};

// Record a course-detail view: always bump the global counter (drives Trending),
// and for logged-in users prepend it to their recent-views list (drives the
// personalised carousels), trimmed to the most recent MAX_RECENT.
export const recordCourseViewService = async ({ courseId, user }) => {
  if (!mongoose.isValidObjectId(courseId)) throw new ApiError(400, "Invalid course id");
  const course = await Course.findByIdAndUpdate(courseId, { $inc: { viewCount: 1 } }, { select: "category" });
  if (!course) throw new ApiError(404, "Course not found");

  if (user?.id) {
    await UserActivity.updateOne(
      { userId: user.id },
      {
        $push: {
          recentViews: {
            $each: [{ courseId, category: course.category, at: new Date() }],
            $position: 0,
            $slice: UserActivity.MAX_RECENT,
          },
        },
      },
      { upsert: true },
    );
  }
};

// Log a search term for a logged-in user (anonymous searches are ignored).
export const logSearchService = async ({ q, user }) => {
  if (!q || !q.trim() || !user?.id) return;
  await UserActivity.updateOne(
    { userId: user.id },
    {
      $push: {
        recentSearches: {
          $each: [{ q: q.trim(), at: new Date() }],
          $position: 0,
          $slice: UserActivity.MAX_RECENT,
        },
      },
    },
    { upsert: true },
  );
};
