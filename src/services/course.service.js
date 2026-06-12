import { Course } from "../models/course.model.js";
import { Module } from "../models/module.model.js";
import { Material } from "../models/material.model.js";
import { Enrollment } from "../models/enrollment.model.js";
import { Progress } from "../models/progress.model.js";
import { uploadToCloudinary, deleteFromCloudinary } from "../utils/cloudinary.util.js";
import { ApiError } from "../utils/ApiError.js";
import { hasOnlineCourseAccess, stripMaterialUrls } from "../utils/courseAccess.js";
import { getOrSet, nsKey, bumpNs } from "../utils/cache.js";

// Cache namespace for public catalog reads (list + categories). Any course
// create/update/delete bumps it, invalidating every cached variant at once.
const COURSES_NS = "courses";

export const createCourseService = async ({ body, file, userId }) => {
  const { title, description, category, level, price, priceOnline, priceOffline, modes, isPublished, totalClasses } = body;
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
    const hasPrice = Number(price) > 0 || Number(priceOnline) > 0 || Number(priceOffline) > 0;
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
    totalClasses: Number(totalClasses) || 0,
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
  const { search, category, level } = query;
  const isAdmin = user && user.role === "admin";

  const runQuery = async () => {
    const filter = {};
    if (!isAdmin) filter.isPublished = true;
    if (category && category.trim()) filter.category = { $regex: category.trim(), $options: "i" };
    if (level && level.trim()) filter.level = level.trim();
    if (search && search.trim()) {
      const regex = { $regex: search.trim(), $options: "i" };
      filter.$or = [{ title: regex }, { category: regex }, { description: regex }];
    }

    const [courses, total] = await Promise.all([
      Course.find(filter).skip((pageNum - 1) * limitNum).limit(limitNum).select("-modules").sort({ createdAt: -1 }),
      Course.countDocuments(filter),
    ]);

    return { courses, total, page: pageNum, limit: limitNum };
  };

  // Admins see drafts and edit constantly → never cache. Public catalog is
  // identical for everyone, so cache it (5 min) keyed by the query variant.
  if (isAdmin) return runQuery();
  const key = await nsKey(COURSES_NS, `list:${pageNum}:${limitNum}:${category || ""}:${level || ""}:${search || ""}`);
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
    "isPublished", "language", "duration", "priceOnline", "priceOffline",
    "totalClasses", "slug", "tag", "subtitle", "tagline", "heroImg",
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

export const deleteCourseService = async (courseId) => {
  const course = await Course.findById(courseId).populate({ path: "modules", populate: { path: "materials" } });
  if (!course) throw new ApiError(404, "Course not found");

  if (course.thumbnailPublicId) await deleteFromCloudinary(course.thumbnailPublicId, "image");

  await Promise.all(
    course.modules.map(async (mod) => {
      await Promise.all(
        mod.materials.map(async (mat) => {
          const resType = mat.type === "video" ? "video" : mat.type === "pdf" ? "raw" : "image";
          await deleteFromCloudinary(mat.publicId, resType);
          await Material.findByIdAndDelete(mat._id);
        })
      );
      await Module.findByIdAndDelete(mod._id);
    })
  );

  await Promise.all([
    Enrollment.deleteMany({ courseId: course._id }),
    Progress.deleteMany({ courseId: course._id }),
  ]);

  await Course.findByIdAndDelete(course._id);
  await bumpNs(COURSES_NS);
};
