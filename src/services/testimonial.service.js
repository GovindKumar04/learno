import { Testimonial } from "../models/testimonial.model.js";
import { ApiError } from "../utils/ApiError.js";
import { uploadToCloudinary, deleteFromCloudinary } from "../utils/cloudinary.util.js";
import { verifyAdminPassword } from "../utils/deleteGuard.util.js";
import { getOrSet, nsKey, bumpNs } from "../utils/cache.js";

const TESTIMONIALS_NS = "testimonials";

const toBool = (v) => v === true || v === "true";
const parseRating = (v) => {
  const n = Number(v);
  return n >= 1 && n <= 5 ? Math.round(n) : null;
};

export const createTestimonialService = async ({ body, file }) => {
  const { name, role = "", quote, rating, order, isPublished, courseId } = body;
  if (!name?.trim() || !quote?.trim()) {
    throw new ApiError(400, "Name and quote are required");
  }

  let avatar = "", avatarPublicId = "";
  if (file) {
    const uploaded = await uploadToCloudinary(file.path, file.mimetype, "testimonials");
    avatar = uploaded.url;
    avatarPublicId = uploaded.publicId;
  }

  const testimonial = await Testimonial.create({
    name: name.trim(),
    role: role.trim(),
    quote: quote.trim(),
    avatar,
    avatarPublicId,
    rating: parseRating(rating),
    courseId: courseId?.trim() ? courseId.trim() : null,
    order: Number(order) || 0,
    isPublished: isPublished === undefined ? true : toBool(isPublished),
  });

  await bumpNs(TESTIMONIALS_NS);
  return testimonial;
};

// Listing is scoped by course:
//   - admin: all testimonials (optionally filtered to one course)
//   - public + courseId: that course's published testimonials
//   - public + no courseId: global (courseId null) published testimonials (homepage)
export const getAllTestimonialsService = async ({ isAdmin, courseId }) => {
  const runQuery = () => {
    let filter;
    if (isAdmin) {
      filter = courseId ? { courseId } : {};
    } else {
      // `{ courseId: null }` also matches docs missing the field (legacy/global).
      filter = { isPublished: true, courseId: courseId || null };
    }
    return Testimonial.find(filter).sort({ order: 1, createdAt: -1 });
  };

  if (isAdmin) return runQuery(); // admins edit often → no cache
  const key = await nsKey(TESTIMONIALS_NS, `list:${courseId || "global"}`);
  return getOrSet(key, 600, runQuery);
};

export const updateTestimonialService = async ({ id, body, file }) => {
  const t = await Testimonial.findById(id);
  if (!t) throw new ApiError(404, "Testimonial not found");

  const { name, role, quote, rating, order, isPublished, courseId } = body;
  if (name !== undefined) t.name = name.trim();
  if (role !== undefined) t.role = role.trim();
  if (quote !== undefined) t.quote = quote.trim();
  if (rating !== undefined) t.rating = parseRating(rating);
  if (courseId !== undefined) t.courseId = courseId?.trim() ? courseId.trim() : null;
  if (order !== undefined) t.order = Number(order) || 0;
  if (isPublished !== undefined) t.isPublished = toBool(isPublished);

  if (file) {
    if (t.avatarPublicId) await deleteFromCloudinary(t.avatarPublicId, "image");
    const uploaded = await uploadToCloudinary(file.path, file.mimetype, "testimonials");
    t.avatar = uploaded.url;
    t.avatarPublicId = uploaded.publicId;
  }

  await t.save();
  await bumpNs(TESTIMONIALS_NS);
  return t;
};

export const deleteTestimonialService = async ({ id, password, adminId }) => {
  await verifyAdminPassword(adminId, password);

  const t = await Testimonial.findById(id);
  if (!t) throw new ApiError(404, "Testimonial not found");

  if (t.avatarPublicId) await deleteFromCloudinary(t.avatarPublicId, "image");
  await Testimonial.findByIdAndDelete(id);
  await bumpNs(TESTIMONIALS_NS);
};
