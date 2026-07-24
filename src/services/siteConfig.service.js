import fs from "fs";
import { SiteConfig } from "../models/siteConfig.model.js";
import { Course } from "../models/course.model.js";
import { getOrSet, cacheDel, bumpNs } from "../utils/cache.js";
import { uploadToCloudinary, deleteFromCloudinary } from "../utils/cloudinary.util.js";
import { ApiError } from "../utils/ApiError.js";
import { resolveRanking, sanitizeRanking, defaultRanking } from "./courseRanking.js";

const SITE_CONFIG_KEY = "site-config";

// The "Courses Available" milestone is shown as the LIVE count of published
// courses instead of a hand-typed number, rounded DOWN to a tidy figure (nearest
// 10, then a "+") so the headline always understates rather than overstates.
const roundDownTidy = (n) => (n >= 10 ? `${Math.floor(n / 10) * 10}+` : `${n}+`);

const applyLiveCourseCount = async (config) => {
  const milestone = config?.milestones?.find((m) => /courses?\s+available/i.test(m?.label || ""));
  if (!milestone) return;
  const count = await Course.countDocuments({ isPublished: true }); // soft-deleted auto-excluded
  milestone.value = roundDownTidy(count);
};

export const DEFAULT_CONFIG = {
  milestones: [
    { value: "500+",  label: "Students Trained",   icon: "👨‍🎓", order: 0 },
    { value: "50+",   label: "Expert Mentors",      icon: "👨‍🏫", order: 1 },
    { value: "20+",   label: "Courses Available",   icon: "📚",  order: 2 },
    { value: "95%",   label: "Placement Rate",      icon: "🎯",  order: 3 },
    { value: "5+",    label: "Years of Excellence", icon: "🏆",  order: 4 },
    { value: "100%",  label: "Practical Training",  icon: "⚡",  order: 5 },
  ],
  whyChooseUs: [
    { title: "Industry Expert Mentors",    description: "Learn directly from professionals with years of industry experience and real-world project knowledge.", icon: "👨‍💼", order: 0 },
    { title: "Hands-On Live Projects",     description: "Work on real projects during training so you graduate with a portfolio that impresses employers.",       icon: "💻",  order: 1 },
    { title: "Job-Placement Support",      description: "We actively help students with resume building, mock interviews, and connecting with hiring partners.",   icon: "🎯",  order: 2 },
    { title: "Flexible Online & Offline",  description: "Choose the mode that works for you — attend live online sessions or join our in-person classroom batches.", icon: "🌐", order: 3 },
    { title: "Affordable Fee Structure",   description: "Quality education shouldn't break the bank. Our courses are priced to be accessible for every aspiring learner.", icon: "💰", order: 4 },
    { title: "Certificate of Completion", description: "Earn a recognised certificate on course completion to boost your professional credibility and LinkedIn profile.", icon: "🏅", order: 5 },
  ],
  faqs: [
    { question: "What courses do you offer?",              answer: "We offer job-oriented courses in Full-Stack Development, UI/UX Design, Graphic Design, Digital Marketing, Cyber Security, AI & ML, Business Analytics, and more.",  order: 0 },
    { question: "Are courses suitable for beginners?",     answer: "Yes. We start from the basics and build up to advanced topics with practical projects and live mentorship.", order: 1 },
    { question: "Do you provide internship opportunities?", answer: "Yes. We offer internship programs where students work on real-time projects to gain practical industry experience.", order: 2 },
    { question: "Are classes online or offline?",          answer: "Both. You can attend live online sessions or join our in-person batches at our Patna centre.", order: 3 },
    { question: "Do you provide certificates?",            answer: "Yes. Students receive a verified certificate on successful course completion, recognized by industry partners.", order: 4 },
    { question: "What is the course duration?",            answer: "Duration varies by course — most programs range from 2 to 6 months. Check individual course pages for exact timelines.", order: 5 },
    { question: "Are there flexible payment options?",     answer: "Yes. We offer EMI and installment options. Contact our team for details.", order: 6 },
    { question: "Do you provide placement support?",       answer: "Yes. We assist with resume building, mock interviews, and connecting students with our hiring partners.", order: 7 },
  ],
  offers: [],
  courseRanking: defaultRanking(),
};

// Resolve the stored (or default) two-level ranking against the LIVE set of
// published-course categories, for the admin editor. Computed fresh (not cached)
// so newly-added categories appear immediately — this is admin-only and off the
// public homepage path.
export const getCourseRankingService = async () => {
  const [doc, live] = await Promise.all([
    SiteConfig.findOne().lean(),
    Course.distinct("category", { isPublished: true }),
  ]);
  return resolveRanking(doc?.courseRanking, live);
};

export const getSiteConfigService = async () => {
  // Public, hit on every homepage load, changes rarely → cache 1h.
  return getOrSet(SITE_CONFIG_KEY, 3600, async () => {
    const doc = await SiteConfig.findOne();
    // Work on a plain object so we can overlay the live course count without
    // mutating/saving the stored document (and so the default is safe to edit).
    const config = doc ? doc.toObject() : structuredClone(DEFAULT_CONFIG);
    await applyLiveCourseCount(config);
    return config;
  });
};

export const updateSiteConfigService = async ({ milestones, whyChooseUs, faqs, offers, logos, courseRanking }) => {
  const update = {};
  if (milestones)  update.milestones  = milestones;
  if (whyChooseUs) update.whyChooseUs = whyChooseUs;
  if (faqs)        update.faqs        = faqs;
  if (offers)      update.offers      = offers;
  // Two-level course discovery ranking (tier order + category order within each
  // tier). Sanitised to known tier keys / string categories. "other" is the
  // catch-all — the ranker forces it last regardless of its stored position.
  if (Array.isArray(courseRanking)) {
    update.courseRanking = sanitizeRanking(courseRanking);
  }
  // Logos are uploaded via updateLogoService; here we only persist editable
  // fields (the zoom level) — never the url/publicId, so a stale client payload
  // can't wipe an uploaded logo.
  if (logos?.navbar?.zoom != null)     update["logos.navbar.zoom"]     = logos.navbar.zoom;
  if (logos?.footer?.zoom != null)     update["logos.footer.zoom"]     = logos.footer.zoom;
  if (logos?.navbar?.removeBg != null) update["logos.navbar.removeBg"] = logos.navbar.removeBg;
  if (logos?.footer?.removeBg != null) update["logos.footer.removeBg"] = logos.footer.removeBg;

  const saved = await SiteConfig.findOneAndUpdate({}, update, { new: true, upsert: true, runValidators: true });
  await cacheDel(SITE_CONFIG_KEY);
  // A ranking change must also invalidate the cached discovery tiers (they live
  // under the "courses" namespace, not the site-config cache key).
  if (update.courseRanking) await bumpNs("courses");
  return saved;
};

// Upload (or replace) the nav-bar / footer logo. `target` selects which slot.
// Replaces the previous Cloudinary asset and preserves the existing zoom level.
export const updateLogoService = async ({ target, filePath, mimetype }) => {
  if (!["navbar", "footer"].includes(target)) {
    // Clean up the temp file the controller would otherwise discard via Cloudinary.
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
    throw new ApiError(400, "Invalid logo target (expected 'navbar' or 'footer')");
  }

  const uploaded = await uploadToCloudinary(filePath, mimetype, "site-logos");

  const config = (await SiteConfig.findOne()) || new SiteConfig();
  const previousPublicId = config.logos?.[target]?.publicId;

  config.logos[target].url = uploaded.url;
  config.logos[target].publicId = uploaded.publicId;
  await config.save();

  // Best-effort cleanup of the replaced asset — don't fail the request if it errors.
  if (previousPublicId && previousPublicId !== uploaded.publicId) {
    try { await deleteFromCloudinary(previousPublicId); } catch { /* ignore */ }
  }

  await cacheDel(SITE_CONFIG_KEY);
  return config;
};
