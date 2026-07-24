// Pure (DB-free) course-ranking logic, shared by course.service.js (which builds
// the discovery carousels) and siteConfig.service.js (which serves/validates the
// admin-editable order). Kept import-free of both of those to avoid a circular
// dependency — it only imports the static tier config.
//
// The ranking is TWO levels: an order of tiers, and an order of categories WITHIN
// each tier. Both are admin-editable (stored on SiteConfig.courseRanking) and fall
// back to the code defaults in CATEGORY_TIERS. Everything is reconciled against the
// LIVE set of categories, so a new/renamed category self-heals: it auto-classifies
// into a tier and is appended to the end of that tier's order.

import { CATEGORY_TIERS, tierKeyOfCategory, TIER_KEYS, DEFAULT_TIER_ORDER } from "../config/courseCategories.js";

const tierByKey = new Map(CATEGORY_TIERS.map((t) => [t.key, t]));
const labelOf = (key) => tierByKey.get(key)?.label || key;

// The effective TIER order: valid saved keys first, then any missing default keys,
// with "other" always forced last (it's the catch-all).
const effectiveTierOrder = (saved) => {
  const savedKeys = (saved || [])
    .map((t) => (typeof t === "string" ? t : t?.key))
    .filter((k) => TIER_KEYS.includes(k));
  const order = [...new Set([...savedKeys, ...DEFAULT_TIER_ORDER])];
  return [...order.filter((k) => k !== "other"), "other"];
};

// Resolve the saved ranking against the live categories into an ordered structure:
//   [{ key, label, categories: [liveCategoryNames in effective order] }]
// `savedRanking` may be the nested form ([{key, categories:[]}]) or a legacy flat
// list of keys ([key]); both are handled.
export const resolveRanking = (savedRanking, liveCategories = []) => {
  const live = liveCategories.filter(Boolean);
  // Bucket live categories by the tier they classify into.
  const liveByTier = new Map(TIER_KEYS.map((k) => [k, []]));
  for (const cat of live) {
    const key = tierKeyOfCategory(cat);
    (liveByTier.get(key) || liveByTier.get("other")).push(cat);
  }

  const savedByKey = new Map(
    (savedRanking || [])
      .filter((t) => t && typeof t === "object" && t.key)
      .map((t) => [t.key, Array.isArray(t.categories) ? t.categories : []]),
  );

  return effectiveTierOrder(savedRanking).map((key) => {
    const liveSet = new Set(liveByTier.get(key) || []);
    // 1) admin's saved order (only categories that still live & still classify here)
    const savedCats = (savedByKey.get(key) || []).filter((c) => liveSet.has(c) && tierKeyOfCategory(c) === key);
    // 2) canonical default order for any not yet included
    const defaultCats = (tierByKey.get(key)?.categories || []).filter((c) => liveSet.has(c));
    // 3) any remaining live categories mapped here (new/keyword-matched)
    const ordered = [...new Set([...savedCats, ...defaultCats, ...(liveByTier.get(key) || [])])];
    return { key, label: labelOf(key), categories: ordered };
  });
};

// Turn a resolved ranking into the ordered tier list `fillDiscovery` consumes:
// each non-"other" category becomes its OWN single-category tier (so category A
// fully precedes B); "other" stays one mixed bucket; a final `undefined` tier is
// the global fallback so a carousel is never left empty.
export const rankingToTiers = (resolved) => {
  const tiers = [];
  for (const { key, categories } of resolved) {
    if (!categories?.length) continue;
    if (key === "other") tiers.push(categories);
    else for (const cat of categories) tiers.push([cat]);
  }
  tiers.push(undefined);
  return tiers;
};

// Normalise an incoming (admin) ranking payload to the stored nested shape:
// keep only known tier keys (de-duped), coerce categories to a string array.
export const sanitizeRanking = (input) => {
  if (!Array.isArray(input)) return null;
  const seen = new Set();
  const out = [];
  for (const entry of input) {
    const key = typeof entry === "string" ? entry : entry?.key;
    if (!TIER_KEYS.includes(key) || seen.has(key)) continue;
    seen.add(key);
    const categories = Array.isArray(entry?.categories)
      ? entry.categories.filter((c) => typeof c === "string" && c.trim())
      : [];
    out.push({ key, categories });
  }
  return out;
};

// The default nested ranking, derived from the code config (used when nothing is
// saved yet).
export const defaultRanking = () =>
  DEFAULT_TIER_ORDER.map((key) => ({ key, categories: [...(tierByKey.get(key)?.categories || [])] }));
