// Seeds 4 NEW draft courses sourced from the Fillip Skill Academy training-content
// Google Doc that were not already present in the catalog: Graphic Design, SEO,
// Google Ads/PPC, and Meta Ads. Each is created UNPUBLISHED (isPublished: false)
// with fully-populated fields (description, pricing, modes, prerequisites,
// benefits, target audience, learn points, highlights, whyChooseUs, FAQs) plus a
// set of linked modules.
//
// Idempotent: a course is skipped if one with the same slug already exists, so
// re-running never duplicates and never touches existing/published courses.
//
//   node src/migration/seedDraftCourses.js
//
// Runs against whichever database MONGODB_URI points to in .env.

import "dotenv/config";
import mongoose from "mongoose";
import connectMongoDB from "../config/mongodb.js";
import { Course } from "../models/course.model.js";
import { Module } from "../models/module.model.js";
import { User } from "../models/user.model.js";

// Shared FAQ set builder — keeps each course's FAQs on-brand and consistent with
// the existing catalog's tone while swapping in the course-specific subject.
const buildFaqs = (subject, cert) => [
  { q: `What will I learn in the ${subject} training?`, a: `Our ${subject} training covers everything from fundamentals to advanced, hands-on techniques used by working professionals.` },
  { q: `Are these ${subject} classes suitable for beginners?`, a: `Yes, the program is designed for complete beginners as well as professionals looking to upskill.` },
  { q: "Will I get practical experience during the training?", a: "Yes, you'll work on live projects and real assignments throughout the course." },
  { q: `Do I receive a ${cert} certification?`, a: `Yes, you will receive a ${cert} certificate upon successful completion.` },
  { q: "Can I get career support after completing the training?", a: "Yes, we provide portfolio building, mock interviews, and placement guidance." },
  { q: "Can I start freelancing after this training?", a: "Yes, the program prepares you to take on freelance clients worldwide." },
  { q: "Do I need any prior experience to join?", a: "No prior experience is required — we start from the basics." },
  { q: "Will I get mentorship support?", a: "Yes, you receive professional mentorship and doubt-solving support." },
  { q: "Do you provide lifetime access to study materials?", a: "Yes, all students get lifetime access to the learning resources." },
  { q: "Why should I choose Fillip Skill Academy?", a: "Fillip Skill Academy offers practical, career-focused training with expert mentors and real project experience." },
];

const whyChooseUs = [
  { title: "Practical, Project-Based Learning", description: "Learn by doing with live projects and real client work — 100% practical skills." },
  { title: "Expert Mentorship", description: "Get guidance from industry professionals with years of hands-on experience." },
  { title: "Portfolio & Placement Support", description: "Build a job-ready portfolio, practice mock interviews, and get career guidance." },
  { title: "Lifetime Access", description: "Revisit all course materials anytime with lifetime access." },
];

// ── Course definitions ──────────────────────────────────────────────────────
const COURSES = [
  {
    title: "Graphic Design Professional",
    slug: "graphic-design-professional",
    category: "Graphic Design",
    level: "beginner",
    description:
      "Master Photoshop, Illustrator, and Canva to create stunning visuals, logos, branding, and marketing creatives for both print and digital media. Build a professional design portfolio through real client-style projects.",
    subtitle: "Photoshop • Illustrator • Canva",
    tagline: "Turn your creativity into a career.",
    tag: "Creative Career Track",
    duration: "4 months",
    price: 9000,
    priceOnline: 8999,
    priceOffline: 15999,
    priceLive: 3000,
    modes: ["self-paced", "classroom", "live"],
    totalClasses: 24,
    totalLiveClasses: 12,
    prerequisites: ["No prior design experience required", "A laptop capable of running design software", "Basic computer familiarity"],
    benefits: ["Real client design projects", "Complete design portfolio", "Adobe & Canva tool mastery", "Freelancing guidance", "Certification prep"],
    targetAudience: ["Aspiring graphic designers", "Marketing & social media professionals", "Freelancers & entrepreneurs", "Students seeking a creative career"],
    learnPoints: ["Photoshop", "Illustrator", "Canva", "Logo & Branding", "Typography", "Social Media Creatives"],
    demandReasons: ["Every business needs visual content", "High freelance demand", "Foundation for UI/UX and marketing roles"],
    highlights: [
      { title: "Industry Tools", desc: "Adobe Photoshop, Illustrator, and Canva Pro." },
      { title: "Portfolio Ready", desc: "Graduate with a полished, presentable design portfolio." },
      { title: "Freelance Skills", desc: "Learn client handling, pricing, and delivery." },
    ],
    faqs: buildFaqs("Graphic Design", "Graphic Design"),
    modules: [
      { title: "Module 1 — Design Foundations", description: "Understand the core principles of graphic design and visual communication.", topics: ["Design Principles", "Color Theory", "Typography", "Composition & Layout", "Visual Hierarchy"], skills: ["Design Thinking", "Color & Typography"] },
      { title: "Module 2 — Adobe Photoshop", description: "Master photo editing, retouching, and digital compositing in Photoshop.", topics: ["Photoshop Interface", "Layers & Masks", "Photo Retouching", "Compositing", "Exporting for Web & Print"], skills: ["Photoshop", "Photo Editing"] },
      { title: "Module 3 — Adobe Illustrator", description: "Create scalable vector graphics, logos, and illustrations.", topics: ["Vector Basics", "Pen Tool", "Logo Design", "Icons & Illustrations", "Branding Kits"], skills: ["Illustrator", "Logo & Branding"] },
      { title: "Module 4 — Canva & Social Media Design", description: "Design fast, on-brand marketing creatives using Canva.", topics: ["Canva Pro", "Social Media Templates", "Brand Kits", "Ad Creatives", "Content Batching"], skills: ["Canva", "Social Media Creatives"] },
      { title: "Module 5 — Portfolio & Freelancing", description: "Build a professional portfolio and learn to work with clients.", topics: ["Portfolio Building", "Client Communication", "Pricing & Proposals", "Freelance Platforms"], skills: ["Portfolio", "Freelancing"], project: "Complete brand identity kit for a mock client." },
    ],
  },
  {
    title: "SEO Specialist",
    slug: "seo-specialist",
    category: "Digital Marketing",
    level: "beginner",
    description:
      "Learn keyword research, on-page and technical SEO, link building, and analytics to rank websites on Google and drive sustainable organic traffic. Work on real websites using industry-standard SEO tools.",
    subtitle: "Rank websites & drive organic traffic",
    tagline: "Get found on Google.",
    tag: "In-Demand Marketing Skill",
    duration: "3 months",
    price: 8000,
    priceOnline: 7999,
    priceOffline: 13999,
    priceLive: 2500,
    modes: ["self-paced", "classroom", "live"],
    totalClasses: 18,
    totalLiveClasses: 9,
    prerequisites: ["No prior SEO experience required", "Basic internet and browser familiarity"],
    benefits: ["Live website SEO projects", "Industry tools access (Ahrefs/SEMrush style)", "Freelancing guidance", "Certification prep"],
    targetAudience: ["Aspiring digital marketers", "Business owners & bloggers", "Freelancers", "Content writers wanting to rank"],
    learnPoints: ["Keyword Research", "On-Page SEO", "Technical SEO", "Link Building", "Google Analytics", "Google Search Console"],
    demandReasons: ["Every business needs organic traffic", "Evergreen, high-ROI skill", "Strong freelance & agency demand"],
    highlights: [
      { title: "Live Projects", desc: "Optimize real websites end-to-end." },
      { title: "Tools Access", desc: "Hands-on with keyword and audit tools." },
      { title: "Analytics", desc: "Measure and report SEO performance." },
    ],
    faqs: buildFaqs("SEO", "SEO"),
    modules: [
      { title: "Module 1 — SEO Fundamentals", description: "Understand how search engines work and how ranking happens.", topics: ["How Search Engines Work", "Crawling & Indexing", "SERP Anatomy", "Ranking Factors"], skills: ["SEO Basics"] },
      { title: "Module 2 — Keyword Research", description: "Find high-value keywords and map them to content.", topics: ["Search Intent", "Keyword Tools", "Long-Tail Keywords", "Competitor Analysis", "Keyword Mapping"], skills: ["Keyword Research"] },
      { title: "Module 3 — On-Page SEO", description: "Optimize pages for both users and search engines.", topics: ["Title & Meta Tags", "Header Structure", "Content Optimization", "Internal Linking", "Schema Markup"], skills: ["On-Page SEO"] },
      { title: "Module 4 — Technical SEO", description: "Ensure a site is fast, crawlable, and error-free.", topics: ["Site Speed", "Mobile-Friendliness", "XML Sitemaps", "Robots.txt", "Core Web Vitals"], skills: ["Technical SEO"] },
      { title: "Module 5 — Off-Page & Analytics", description: "Build authority and measure results.", topics: ["Link Building", "Backlink Analysis", "Google Analytics", "Google Search Console", "SEO Reporting"], skills: ["Link Building", "Analytics"], project: "Full SEO audit and optimization plan for a live website." },
    ],
  },
  {
    title: "Google Ads & PPC Training",
    slug: "google-ads-ppc-training",
    category: "Digital Marketing",
    level: "beginner",
    description:
      "Master Google Ads and PPC campaign management across Search, Display, Shopping, and YouTube. Learn to plan budgets, write high-converting ads, optimize bids, and run profitable, high-ROI paid campaigns.",
    subtitle: "Search • Display • Shopping • YouTube",
    tagline: "Run profitable paid campaigns.",
    tag: "High-ROI Skill",
    duration: "2 months",
    price: 7000,
    priceOnline: 6999,
    priceOffline: 12999,
    priceLive: 2500,
    modes: ["self-paced", "classroom", "live"],
    totalClasses: 16,
    totalLiveClasses: 8,
    prerequisites: ["No prior advertising experience required", "Basic internet familiarity"],
    benefits: ["Run live ad campaigns", "Industry tools access", "Freelancing guidance", "Certification prep"],
    targetAudience: ["Aspiring digital marketers", "Business owners & entrepreneurs", "Freelancers & agencies", "Marketing professionals"],
    learnPoints: ["Google Ads", "Search Campaigns", "Display & YouTube Ads", "Keyword Bidding", "Conversion Tracking", "Campaign Optimization"],
    demandReasons: ["Businesses spend heavily on paid ads", "Immediate, measurable results", "High freelance & agency demand"],
    highlights: [
      { title: "Live Campaigns", desc: "Build and manage real Google Ads campaigns." },
      { title: "Conversion Tracking", desc: "Measure ROI with proper tracking setup." },
      { title: "Optimization", desc: "Lower cost-per-click and boost conversions." },
    ],
    faqs: buildFaqs("Google Ads", "Google Ads / PPC"),
    modules: [
      { title: "Module 1 — PPC & Google Ads Basics", description: "Understand paid advertising and the Google Ads ecosystem.", topics: ["PPC Fundamentals", "Google Ads Account Structure", "Campaign Types", "Auction & Ad Rank"], skills: ["PPC Basics"] },
      { title: "Module 2 — Search Campaigns", description: "Build high-intent search campaigns that convert.", topics: ["Keyword Match Types", "Ad Groups", "Responsive Search Ads", "Ad Extensions", "Negative Keywords"], skills: ["Search Campaigns"] },
      { title: "Module 3 — Display, Shopping & YouTube", description: "Expand reach across Google's networks.", topics: ["Display Network", "Shopping Ads", "YouTube Video Ads", "Audience Targeting", "Remarketing"], skills: ["Display & Video Ads"] },
      { title: "Module 4 — Tracking & Optimization", description: "Measure performance and maximize ROI.", topics: ["Conversion Tracking", "Bidding Strategies", "Quality Score", "A/B Testing", "Reporting & Optimization"], skills: ["Conversion Tracking", "Optimization"], project: "Plan, launch, and optimize a live Google Ads campaign." },
    ],
  },
  {
    title: "Meta Ads (Facebook & Instagram)",
    slug: "meta-ads-facebook-instagram",
    category: "Digital Marketing",
    level: "beginner",
    description:
      "Run high-converting Facebook and Instagram ad campaigns. Learn audience targeting, creative strategy, Meta Pixel setup, retargeting, and budget optimization to generate leads and sales through social advertising.",
    subtitle: "Facebook • Instagram advertising",
    tagline: "Turn scrolls into sales.",
    tag: "Social Advertising",
    duration: "2 months",
    price: 7000,
    priceOnline: 6999,
    priceOffline: 12999,
    priceLive: 2500,
    modes: ["self-paced", "classroom", "live"],
    totalClasses: 16,
    totalLiveClasses: 8,
    prerequisites: ["No prior advertising experience required", "A Facebook/Instagram account", "Basic internet familiarity"],
    benefits: ["Run live Meta ad campaigns", "Creative & copywriting practice", "Freelancing guidance", "Certification prep"],
    targetAudience: ["Aspiring digital marketers", "E-commerce & business owners", "Freelancers & agencies", "Social media managers"],
    learnPoints: ["Meta Ads Manager", "Audience Targeting", "Ad Creatives", "Meta Pixel", "Retargeting", "Budget Optimization"],
    demandReasons: ["Massive audience on Facebook & Instagram", "Powerful targeting for any niche", "High freelance & e-commerce demand"],
    highlights: [
      { title: "Live Campaigns", desc: "Launch real Facebook & Instagram ad campaigns." },
      { title: "Pixel & Retargeting", desc: "Track users and re-engage them for conversions." },
      { title: "Creative Strategy", desc: "Design scroll-stopping ad creatives and copy." },
    ],
    faqs: buildFaqs("Meta Ads", "Meta Ads"),
    modules: [
      { title: "Module 1 — Meta Ads Foundations", description: "Understand the Meta advertising ecosystem and Ads Manager.", topics: ["Meta Business Suite", "Ads Manager", "Campaign Objectives", "Account Structure"], skills: ["Meta Ads Basics"] },
      { title: "Module 2 — Audience & Targeting", description: "Reach the right people with precise targeting.", topics: ["Core Audiences", "Custom Audiences", "Lookalike Audiences", "Detailed Targeting"], skills: ["Audience Targeting"] },
      { title: "Module 3 — Creatives & Copywriting", description: "Craft ads that stop the scroll and convert.", topics: ["Ad Formats", "Creative Strategy", "Ad Copywriting", "Carousel & Video Ads", "A/B Testing"], skills: ["Ad Creatives", "Copywriting"] },
      { title: "Module 4 — Pixel, Retargeting & Scaling", description: "Track conversions and scale winning campaigns.", topics: ["Meta Pixel Setup", "Conversion Events", "Retargeting Campaigns", "Budget Optimization", "Scaling Strategies"], skills: ["Meta Pixel", "Retargeting"], project: "Launch and optimize a live lead-generation campaign on Meta." },
    ],
  },
];

async function run() {
  await connectMongoDB();
  console.log(`⏳ Seeding draft courses on database "${mongoose.connection.name}"`);

  // createdBy must reference a real admin user id (String _id in this schema).
  const admin = await User.findOne({ role: "admin" }).select("_id email");
  if (!admin) {
    console.error("❌ No admin user found. Run `npm run seed:admin` first.");
    await mongoose.connection.close();
    process.exit(1);
  }
  console.log(`   Using admin as createdBy: ${admin.email} (${admin._id})`);

  let created = 0;
  let skipped = 0;

  for (const def of COURSES) {
    const exists = await Course.findOne({ $or: [{ slug: def.slug }, { title: def.title }] }).select("_id title slug isPublished");
    if (exists) {
      skipped += 1;
      console.log(`   ⏭  Skipped (already exists): ${exists.title} [pub: ${exists.isPublished}]`);
      continue;
    }

    const { modules: moduleDefs, ...courseFields } = def;

    // Create the course first (unpublished) so modules can reference its _id.
    const course = await Course.create({
      ...courseFields,
      isPublished: false, // ← explicitly a DRAFT; do NOT publish
      createdBy: admin._id,
      language: "English",
    });

    // Create and link modules in order.
    const moduleIds = [];
    for (let i = 0; i < moduleDefs.length; i++) {
      const m = moduleDefs[i];
      const mod = await Module.create({
        title: m.title,
        description: m.description || "",
        course: course._id,
        order: i + 1,
        topics: m.topics || [],
        skills: m.skills || [],
        project: m.project || "",
        materials: [],
      });
      moduleIds.push(mod._id);
    }
    course.modules = moduleIds;
    await course.save();

    created += 1;
    console.log(`   ✅ Created DRAFT: ${course.title} (${moduleIds.length} modules) — slug: ${course.slug}`);
  }

  console.log(`\n✅ Done — ${created} created, ${skipped} skipped. All new courses are UNPUBLISHED.`);
  await mongoose.connection.close();
  process.exit(0);
}

run().catch(async (err) => {
  console.error("❌ Draft-course seed failed:", err);
  try { await mongoose.connection.close(); } catch { /* ignore */ }
  process.exit(1);
});
