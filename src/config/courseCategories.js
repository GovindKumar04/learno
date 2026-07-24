// Course-category taxonomy + computer-science classification.
//
// `category` is a free-form String on the Course model (no enum, no Category
// collection), so new courses can introduce category names we don't know about
// yet. To keep the home-page discovery carousels "mostly CS" without silently
// dropping future software/web-dev/data courses filed under a new label, we
// classify a category as CS-related via TWO layers:
//
//   1. An explicit seed list — the known canonical CS buckets.
//   2. A keyword matcher on the category NAME — so any future CS-flavoured
//      category (e.g. "Game Development", "IT & Networking", "Data Engineering")
//      is recognised automatically, no code change required.
//
// Callers additionally fall back to an unfiltered list when nothing matches, so
// a carousel is never left blank. Keep this the single source of truth; scripts
// and services should import from here rather than re-declaring the list.

// The canonical 12-category taxonomy — the single source of truth for course
// categories. Keep this in sync with the client mirror at
// `client/src/constants/courseCategories.js`. New courses should be filed under
// one of these; a genuinely new category can still be added, but prefer these.
export const COURSE_TAXONOMY = [
  "Artificial Intelligence & Data Science",
  "Web & Mobile Development",
  "Software & Emerging Tech",
  "Cloud & DevOps",
  "Cyber Security",
  "Design & Multimedia",
  "Digital Marketing",
  "Finance & Accounting",
  "Business & Management",
  "Entrepreneurship & Startup",
  "Computer & Office Basics",
  "Career Development",
];

// ─── Discovery ranking tiers ─────────────────────────────────────────────────
//
// The home-page discovery carousels are ranked by BUSINESS PRIORITY, reflecting
// what the company teaches in-house (computer science, especially development)
// vs hires out (marketing, design, business, ...). Categories are grouped into
// ordered tiers; the carousels fill from the first tier down.
//
// Each tier lists its canonical `categories` AND a `keywords` matcher on the
// category NAME, so a future/renamed category auto-classifies (e.g. a new
// "Game Development" lands in `dev`, "IT & Networking" in `cs`) with no code
// change. A category matching nothing falls into `other` (the catch-all).
//
// This ordered list is the DEFAULT order; admins can reorder the tiers at
// runtime (stored on SiteConfig.courseRanking) — see course.service.js. Keep the
// keys/labels in sync with the client mirror at
// `client/src/constants/courseCategories.js`.
export const CATEGORY_TIERS = [
  {
    key: "dev",
    label: "Development",
    categories: ["Web & Mobile Development", "Software & Emerging Tech"],
    keywords: [
      "web develop", "app develop", "mobile develop", "game develop",
      "software", "developer", "programming", "coding", "full stack",
      "frontend", "front-end", "backend", "back-end", "web3", "emerging tech",
    ],
  },
  {
    key: "cs",
    label: "Other Computer Science",
    categories: [
      "Artificial Intelligence & Data Science",
      "Cloud & DevOps",
      "Cyber Security",
      "Computer & Office Basics",
    ],
    keywords: [
      "data science", "data engineering", "data analytics", "machine learning",
      "artificial intelligence", "deep learning", "cloud", "devops", "cyber",
      "security", "networking", "computer", "information technology",
      "blockchain", "robotics", "embedded",
    ],
  },
  {
    key: "marketing",
    label: "Digital Marketing",
    categories: ["Digital Marketing"],
    keywords: ["marketing"],
  },
  {
    key: "other",
    label: "Everything Else",
    categories: [], // catch-all: the remaining canonical categories + unknowns
    keywords: [],
  },
];

// All tier keys, and the default order they appear in above.
export const TIER_KEYS = CATEGORY_TIERS.map((t) => t.key);
export const DEFAULT_TIER_ORDER = [...TIER_KEYS];

// The tier a category belongs to: exact canonical match first, then keyword
// heuristic; anything unmatched falls to the "other" catch-all.
export const tierKeyOfCategory = (name) => {
  if (!name || typeof name !== "string") return "other";
  const lower = name.toLowerCase();
  for (const tier of CATEGORY_TIERS) {
    if (tier.categories.includes(name)) return tier.key;
    if (tier.keywords.some((kw) => lower.includes(kw))) return tier.key;
  }
  return "other";
};

// Computer-science = the `dev` or `cs` tier. Kept for callers that only need the
// CS/non-CS distinction (e.g. course seeding).
export const isCsCategory = (name) => {
  const key = tierKeyOfCategory(name);
  return key === "dev" || key === "cs";
};
