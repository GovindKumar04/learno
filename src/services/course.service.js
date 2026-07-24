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
import { getSiteConfigService } from "./siteConfig.service.js";
import { resolveRanking, rankingToTiers } from "./courseRanking.js";

// Cache namespace for public catalog reads (list + categories). Any course
// create/update/delete bumps it, invalidating every cached variant at once.
const COURSES_NS = "courses";

// How many cards a single home-page discovery carousel shows.
const DISCOVERY_LIMIT = 12;

// Build the ordered discovery tiers from the two-level ranking (tier order +
// category order within each tier). The admin order lives on SiteConfig; it's
// reconciled against the LIVE published-course categories (so new/renamed ones
// auto-slot) and turned into the single-category tier list `fillDiscovery` walks,
// ending in a global fallback so a carousel is never blank. Cached under
// COURSES_NS — bumped whenever a course OR the ranking changes.
const getDiscoveryTiers = async () => {
  const key = await nsKey(COURSES_NS, "discovery-tiers");
  return getOrSet(key, 300, async () => {
    let saved = null;
    try {
      const cfg = await getSiteConfigService();
      saved = Array.isArray(cfg?.courseRanking) ? cfg.courseRanking : null;
    } catch {
      // SiteConfig unavailable → resolveRanking falls back to the code default.
    }
    const live = await Course.distinct("category", { isPublished: true });
    return rankingToTiers(resolveRanking(saved, live));
  });
};

// Fill a carousel by walking ordered category "tiers": priority categories
// first, then the rest of the CS set, then (last resort) an unfiltered global
// fetch. Each tier only fills the remaining slots and excludes what earlier
// tiers already returned, so priority courses always lead and the carousel is
// never left empty. An `undefined` tier means "no category filter"; an empty
// array tier is skipped (an empty $in would otherwise fetch everything).
const fillDiscovery = async ({ sort, limit, tiers, exclude = [] }) => {
  const excl = [...exclude];
  let result = [];
  for (const cats of tiers) {
    if (result.length >= limit) break;
    if (Array.isArray(cats) && cats.length === 0) continue;
    const extra = await fetchPublishedCourses({
      sort,
      limit: limit - result.length,
      categories: cats,
      excludeIds: excl,
    });
    for (const c of extra) excl.push(String(c._id));
    result = [...result, ...extra];
  }
  return result;
};

// Fetch a discovery carousel by walking the business-priority tiers (Development
// → other CS → Digital Marketing → everything else, admin-reorderable), then a
// global fallback so the section never renders empty.
const fetchCsDiscovery = async ({ sort, limit }) => {
  const tiers = await getDiscoveryTiers();
  return fillDiscovery({ sort, limit, tiers });
};

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
  } else if (body.removeThumbnail === "true" || body.removeThumbnail === true) {
    // Explicit "remove thumbnail" with no replacement uploaded.
    if (course.thumbnailPublicId) await deleteFromCloudinary(course.thumbnailPublicId, "image");
    course.thumbnail = undefined;
    course.thumbnailPublicId = undefined;
  }

  if (course.isPublished) {
    const hasPrice = course.price > 0 || course.priceOnline > 0 || course.priceOffline > 0;
    if (!hasPrice) throw new ApiError(400, "Assign a price before publishing this course");
  }

  await course.save();
  await bumpNs(COURSES_NS);
  return course;
};

// ─── Recycle bin (soft delete / restore / purge) ────────────────────────────

// Move a course to the recycle bin (soft delete). The course and its modules /
// materials are kept intact and hidden; it stays in the bin indefinitely until an
// admin restores or permanently deletes it. We only block on things that make
// hiding the course harmful or irreversible: students mid-course, or issued
// certificates that reference it.
export const deleteCourseService = async ({ courseId }) => {
  const course = await Course.findById(courseId);
  if (!course) throw new ApiError(404, "Course not found");

  const [activeEnrollments, certificates] = await Promise.all([
    Enrollment.countDocuments({ courseId, isActive: true }),
    Certificate.countDocuments({ courseId }),
  ]);
  assertNoDependents("course", [
    { label: "active enrollment(s)", count: activeEnrollments },
    { label: "issued certificate(s)", count: certificates },
  ]);

  course.deletedAt = new Date();
  await course.save();
  await bumpNs(COURSES_NS);
  return course;
};

// Physically remove a course and everything that belongs only to it. Used by the
// permanent-delete action and the retention sweep. Best-effort on Cloudinary so a
// single asset failure can't leave the DB half-cleaned.
const cascadeDeleteCourse = async (course) => {
  const courseId = course._id;

  const modules = await Module.find({ course: courseId }).select("_id").lean();
  const moduleIds = modules.map((m) => m._id);

  if (moduleIds.length) {
    const materials = await Material.find({ module: { $in: moduleIds } }).select("publicId type").lean();
    for (const mat of materials) {
      if (!mat.publicId) continue;
      const resType = mat.type === "video" ? "video" : mat.type === "pdf" ? "raw" : "image";
      await deleteFromCloudinary(mat.publicId, resType).catch(() => {});
    }
    await Material.deleteMany({ module: { $in: moduleIds } });
    await Module.deleteMany({ course: courseId });
  }

  if (course.thumbnailPublicId) await deleteFromCloudinary(course.thumbnailPublicId, "image").catch(() => {});

  await Promise.all([
    Batch.deleteMany({ courseId }),
    OnlineClass.deleteMany({ courseId }),
    Enrollment.deleteMany({ courseId }),
    Progress.deleteMany({ courseId }),
  ]);

  // deleteOne isn't affected by the soft-delete scope, so it removes the binned doc.
  await Course.deleteOne({ _id: courseId });
};

// List every course currently in the recycle bin (most recently deleted first).
// Courses stay here indefinitely until an admin restores or purges them.
export const listDeletedCoursesService = async () => {
  return Course.find({ deletedAt: { $ne: null } })
    .setOptions({ withDeleted: true })
    .select("-modules -reviews")
    .sort({ deletedAt: -1 })
    .lean();
};

// Restore a binned course back to its previous (live) state.
export const restoreCourseService = async ({ courseId }) => {
  const course = await Course.findOne({ _id: courseId, deletedAt: { $ne: null } }).setOptions({ withDeleted: true });
  if (!course) throw new ApiError(404, "Course not found in the recycle bin");
  course.deletedAt = null;
  await course.save();
  await bumpNs(COURSES_NS);
  return course;
};

// Permanently delete a binned course now (skips the 60-day wait). Password-gated.
export const permanentlyDeleteCourseService = async ({ courseId, password, adminId }) => {
  await verifyAdminPassword(adminId, password);
  const course = await Course.findOne({ _id: courseId }).setOptions({ withDeleted: true });
  if (!course) throw new ApiError(404, "Course not found");
  await cascadeDeleteCourse(course);
  await bumpNs(COURSES_NS);
};

// ─── Home-page discovery ────────────────────────────────────────────────────

// Trending = most viewed (with enrollments as a tie-breaker). Biased to
// computer-science categories, with a global fallback. Cached.
export const getTrendingCoursesService = async ({ limit = DISCOVERY_LIMIT } = {}) => {
  const key = await nsKey(COURSES_NS, `trending:cs:${limit}`);
  return getOrSet(key, 300, () => fetchCsDiscovery({ sort: "trending", limit }));
};

// Highest-rated courses, biased to computer-science categories, with a global
// fallback. Cached.
export const getTopRatedCoursesService = async ({ limit = DISCOVERY_LIMIT } = {}) => {
  const key = await nsKey(COURSES_NS, `toprated:cs:${limit}`);
  return getOrSet(key, 300, () => fetchCsDiscovery({ sort: "rating", limit }));
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

// Recommended = the same business-priority tiers (Development → other CS →
// Digital Marketing → everything else), sorted by popularity, excluding what the
// user has recently viewed. Not cached because the exclude set is personalised;
// anonymous callers pass their recently-viewed ids via `excludeIds`.
export const getRecommendedCoursesService = async ({ user, categories, excludeIds, limit = DISCOVERY_LIMIT }) => {
  const { excl } = await gatherSignal({ user, categories, excludeIds });
  const tiers = await getDiscoveryTiers();
  return fillDiscovery({ sort: "popular", limit, exclude: excl, tiers });
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
