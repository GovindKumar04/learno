/**
 * Seed two Web-Development programs with full module content:
 *   1. Backend Development with Node.js   (3-month program)
 *   2. Frontend Development with React.js (1-month, React-only: hooks, Context API, Redux)
 *
 * Both are filed under the canonical category "Web & Mobile Development" so they
 * flow into the CS-biased + priority discovery carousels automatically.
 *
 * - Each program → one Course document + its Module documents (topic-based, not
 *   labelled by week/month). Original sequence preserved via each module `order`.
 * - Idempotent: upserts by slug and rebuilds that course's modules on re-run.
 * - Created as DRAFTS (isPublished:false) unless SEED_PUBLISH=true.
 * - Content is authored inline (only two courses) rather than parsed from a file.
 *
 * Run from the backend folder:
 *   Dry run:  SEED_DRY=true node src/scripts/seedWebDevCourses.js
 *   Publish:  SEED_PUBLISH=true node src/scripts/seedWebDevCourses.js
 */
import "dotenv/config";
import mongoose from "mongoose";
import connectMongoDB from "../config/mongodb.js";
import { Course } from "../models/course.model.js";
import { Module } from "../models/module.model.js";
import { User } from "../models/user.model.js";
import { bumpNs } from "../utils/cache.js";

const PUBLISH = process.env.SEED_PUBLISH === "true";
const DRY = process.env.SEED_DRY === "true";
const CATEGORY = "Web & Mobile Development";
const FEE = 14999; // adjustable placeholder; a >0 price is required to publish

const toSlug = (str) =>
  str.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// ── Course definitions ────────────────────────────────────────────────────────
const COURSES = [
  {
    name: "Backend Development with Node.js",
    duration: "3 Months",
    summary:
      "A hands-on 3-month program that takes you from JavaScript fundamentals to " +
      "shipping secure, tested REST APIs on Node.js — Express, MongoDB/Mongoose, " +
      "authentication and deployment, finishing with a job-ready backend capstone.",
    modules: [
      {
        title: "JavaScript & Node.js Foundations",
        description: "The runtime, tooling and language essentials backend work is built on.",
        topics: [
          "Node.js runtime & the V8 engine",
          "npm, package.json & semantic versioning",
          "CommonJS vs ES modules",
          "The event loop & non-blocking I/O",
          "Modern JavaScript (ES6+) refresher",
        ],
        skills: ["JavaScript ES6+", "npm", "Node.js runtime"],
        project: "Build a small command-line utility packaged with npm.",
      },
      {
        title: "Asynchronous Programming & Node Core Modules",
        description: "Master async patterns and the built-in modules Node ships with.",
        topics: [
          "Callbacks, promises & async/await",
          "Error handling in async code",
          "fs, path, os & events modules",
          "Streams & buffers",
          "Working with the file system",
        ],
        skills: ["Async/await", "Streams", "Node core APIs"],
        project: "A file-processing tool that reads, transforms and writes data via streams.",
      },
      {
        title: "Building REST APIs with Express.js",
        description: "Design and build structured, maintainable HTTP APIs.",
        topics: [
          "Express routing & the request/response cycle",
          "Middleware & the controller pattern",
          "Centralised error handling",
          "Request validation",
          "REST conventions & status codes",
        ],
        skills: ["Express.js", "REST API design", "Middleware"],
        project: "A Task Manager REST API with full CRUD endpoints.",
      },
      {
        title: "Databases with MongoDB & Mongoose",
        description: "Persist and model application data effectively.",
        topics: [
          "MongoDB fundamentals & documents",
          "Mongoose schemas & models",
          "CRUD operations & querying",
          "Relationships & population",
          "Indexing & the aggregation pipeline",
        ],
        skills: ["MongoDB", "Mongoose", "Data modeling"],
        project: "The data layer for a blog: users, posts and comments.",
      },
      {
        title: "Authentication, Security & Testing",
        description: "Protect your API and prove it works.",
        topics: [
          "JWT & session-based authentication",
          "Password hashing with bcrypt",
          "Role-based access control (RBAC)",
          "Security hardening: Helmet, CORS, rate limiting",
          "Testing with Jest & Supertest",
        ],
        skills: ["JWT", "bcrypt", "Jest", "API security"],
        project: "A secured auth API with signup/login and protected, tested routes.",
      },
      {
        title: "Deployment, DevOps Basics & Capstone",
        description: "Take a Node backend from local to production.",
        topics: [
          "Environment configuration & secrets",
          "Logging & monitoring",
          "Docker basics for Node apps",
          "CI/CD fundamentals",
          "Deploying to the cloud",
        ],
        skills: ["Docker basics", "CI/CD", "Cloud deployment"],
        project: "Capstone: design, build and deploy a complete backend service.",
      },
    ],
  },
  {
    name: "Frontend Development with React.js",
    duration: "1 Month",
    summary:
      "A focused 1-month, React-only program (JavaScript knowledge assumed) that " +
      "builds modern, production-ready user interfaces — components and hooks, " +
      "global state with the Context API and Redux, routing, and testing, " +
      "finishing with a full React capstone.",
    modules: [
      {
        title: "React Fundamentals",
        description: "Think in components and render UI declaratively.",
        topics: [
          "JSX & rendering",
          "Components & props",
          "Rendering lists & keys",
          "Handling events",
          "Composing a component tree",
        ],
        skills: ["React", "JSX", "Component design"],
        project: "A static, component-driven product page UI.",
      },
      {
        title: "Hooks & Component Lifecycle",
        description: "Add interactivity and manage local component state.",
        topics: [
          "useState & useEffect",
          "useRef & the rules of hooks",
          "Custom hooks",
          "Controlled form inputs",
          "The component lifecycle",
        ],
        skills: ["React hooks", "Custom hooks"],
        project: "A fully interactive Todo application.",
      },
      {
        title: "Global State with the Context API",
        description: "Share state across the tree without prop drilling.",
        topics: [
          "Context & the Provider pattern",
          "useContext",
          "useReducer for structured state",
          "Combining Context with reducers",
          "Theme & auth context patterns",
        ],
        skills: ["Context API", "useContext", "useReducer"],
        project: "A theme + auth provider shared across a multi-page UI.",
      },
      {
        title: "State Management with Redux",
        description: "Predictable app-wide state with Redux Toolkit.",
        topics: [
          "Redux core concepts: store, actions, reducers",
          "Redux Toolkit: configureStore & slices",
          "useSelector & useDispatch",
          "Async logic with thunks",
          "Context API vs Redux — when to use which",
        ],
        skills: ["Redux", "Redux Toolkit", "React-Redux"],
        project: "A cart/store app whose state is managed with Redux Toolkit.",
      },
      {
        title: "Routing, API Integration, Testing & Capstone",
        description: "Assemble, test and ship a complete React app.",
        topics: [
          "Client-side routing with React Router",
          "Fetching & displaying remote data",
          "Loading & error states",
          "Testing with React Testing Library",
          "Building & deploying",
        ],
        skills: ["React Router", "Data fetching", "React Testing Library", "Deployment"],
        project: "Capstone: a routed, Redux/Context-powered React app, tested and deployed.",
      },
    ],
  },
];

function buildDescription(c) {
  const first3 = c.modules.slice(0, 3).map((m) => m.title).join(", ");
  const period = c.duration === "1 Month" ? "month" : "program";
  return (
    `${c.summary} Over the ${period} you'll progress through ${first3} and beyond, ` +
    `finishing with a capstone project and a job-ready portfolio.`
  );
}

async function run() {
  console.log(`Seeding ${COURSES.length} Web-Development programs.`);

  if (DRY) {
    for (const c of COURSES) {
      console.log(`\n• ${c.name}  [${CATEGORY}]  ₹${FEE}  — ${c.duration}`);
      c.modules.forEach((m, i) =>
        console.log(`    ${i + 1}. ${m.title}  (${m.topics.length} topics, ${m.skills.length} skills)`),
      );
    }
    console.log("\n(dry run — no database changes)");
    return;
  }

  await connectMongoDB();

  const admin = await User.findOne({ role: "admin" }).select("_id").lean();
  if (!admin) {
    console.error("❌ No admin user found to own the courses (createdBy).");
    await mongoose.disconnect();
    process.exit(1);
  }
  const createdBy = String(admin._id);

  let created = 0, updated = 0;
  for (const c of COURSES) {
    const slug = toSlug(c.name);
    const learnPoints = c.modules.map((m) => m.title);

    // These two slugs are owned solely by this script, so upsert the base slug in
    // place — including when a course's duration changes (e.g. 3 Months → 1 Month).
    let course = await Course.findOne({ slug }).setOptions({ withDeleted: true });
    const isNew = !course;
    if (!course) course = new Course({ slug, createdBy });

    course.set({
      title: c.name,
      description: buildDescription(c),
      category: CATEGORY,
      level: "beginner",
      duration: c.duration,
      price: FEE,
      priceOnline: FEE,
      priceOffline: FEE,
      priceLive: 0,
      modes: ["self-paced", "classroom"],
      learnPoints,
      isPublished: PUBLISH,
      deletedAt: null,
      createdBy: course.createdBy || createdBy,
    });
    await course.save();

    await Module.deleteMany({ course: course._id });
    const mods = await Module.insertMany(
      c.modules.map((m, i) => ({
        title: m.title,
        description: m.description,
        course: course._id,
        order: i + 1,
        topics: m.topics,
        skills: m.skills,
        project: m.project,
      })),
    );
    course.modules = mods.map((m) => m._id);
    await course.save();

    if (isNew) created++; else updated++;
    console.log(`  ${isNew ? "＋ created" : "↻ updated"}: ${c.name}  (${c.modules.length} modules, ₹${FEE})`);
  }

  await bumpNs("courses"); // invalidate cached catalog list, categories & discovery carousels
  console.log(`\n✅ Done. ${created} created, ${updated} updated. Published: ${PUBLISH ? "YES" : "NO (drafts)"}`);
  await mongoose.disconnect();
  process.exit(0);
}

run().catch(async (e) => {
  console.error("Seed failed:", e);
  try { await mongoose.disconnect(); } catch { /* ignore */ }
  process.exit(1);
});
