// Tools the onboarding assistant can call. Each is a thin, READ-ONLY wrapper over an
// existing service, always scoped server-side to the authenticated user (req.user) — a
// client can never request another user's data.

import { getAllCoursesService } from "./course.service.js";
import { getMyCoursesService } from "./enrollment.service.js";
import { getMyBatchesService } from "./batch.service.js";
import { onboardingSteps } from "../config/knowledgeBase.js";

const roleOf = (user) => user?.role || "guest";

// ── Executors ────────────────────────────────────────────────────────────────
// Signature: async (args, user) => any (JSON-serialisable). Keep payloads small.

const listCourses = async (args = {}) => {
  const { search, category, level } = args;
  const { courses, total } = await getAllCoursesService({
    query: { search, category, level, limit: 8 },
    user: null, // force the public (published-only) view regardless of who is asking
  });
  return {
    total,
    courses: courses.map((c) => ({
      title: c.title,
      category: c.category,
      level: c.level,
      price: c.price,
      modes: c.modes,
      slug: c.slug,
    })),
  };
};

const getOnboardingSteps = async (_args, user) => {
  const role = roleOf(user);
  return { role, steps: onboardingSteps[role] || onboardingSteps.guest };
};

const getMyCourses = async (_args, user) => {
  if (!user) return { error: "not_signed_in", message: "The user is not signed in. Ask them to log in at /auth to see their enrolled courses, progress and attendance." };
  const enrolled = await getMyCoursesService(user.id);
  return {
    count: enrolled.length,
    courses: enrolled.map((e) => ({
      title: e.course?.title,
      enrollmentType: e.enrollmentType,
      progressPercent: e.progress?.completionPercent ?? 0,
      attendance: e.attendance
        ? { present: e.attendance.present, totalClasses: e.attendance.totalClasses, ratePercent: e.attendance.rate, eligibleForCertificate: e.attendance.eligible, classesNeeded: e.attendance.classesNeeded }
        : null,
      completed: e.completed,
    })),
  };
};

const getMyBatches = async (_args, user) => {
  if (!user) return { error: "not_signed_in", message: "The user is not signed in. Ask them to log in as an instructor to see their batches." };
  const batches = await getMyBatchesService(user.id);
  return {
    count: batches.length,
    batches: batches.map((b) => ({
      name: b.name,
      course: b.course?.title,
      studentCount: b.studentCount,
      schedule: b.schedule,
      location: b.location,
      status: b.status,
    })),
  };
};

// ── Schemas + dispatch ───────────────────────────────────────────────────────

const SCHEMAS = {
  list_courses: {
    type: "function",
    function: {
      name: "list_courses",
      description: "List published courses (optionally filtered). Use when the user asks what courses are offered, prices, levels, or how to find a course.",
      parameters: {
        type: "object",
        properties: {
          search: { type: "string", description: "Free-text search over title/category/description" },
          category: { type: "string", description: "Filter by category" },
          level: { type: "string", description: "Filter by level, e.g. Beginner/Intermediate/Advanced" },
        },
      },
    },
  },
  get_onboarding_steps: {
    type: "function",
    function: {
      name: "get_onboarding_steps",
      description: "Get the short, role-appropriate getting-started checklist for the current user (guest/student/instructor/admin).",
      parameters: { type: "object", properties: {} },
    },
  },
  get_my_courses: {
    type: "function",
    function: {
      name: "get_my_courses",
      description: "Get the signed-in student's enrolled courses with their self-paced progress and classroom/live attendance. Use for questions like 'what am I enrolled in', 'how's my progress', 'how's my attendance', 'am I eligible for a certificate'.",
      parameters: { type: "object", properties: {} },
    },
  },
  get_my_batches: {
    type: "function",
    function: {
      name: "get_my_batches",
      description: "Get the signed-in instructor's batches (course, schedule, location, student count, status). Use for questions like 'what batches am I teaching'.",
      parameters: { type: "object", properties: {} },
    },
  },
};

const EXECUTORS = {
  list_courses: listCourses,
  get_onboarding_steps: getOnboardingSteps,
  get_my_courses: getMyCourses,
  get_my_batches: getMyBatches,
};

// Tool names available to a given user (instructor/admin get batch access too).
const toolNamesFor = (user) => {
  const names = ["list_courses", "get_onboarding_steps"];
  if (user) names.push("get_my_courses");
  if (user && (user.role === "instructor" || user.role === "admin")) names.push("get_my_batches");
  return names;
};

// Expose only the tools that make sense for this user, to cut noise/tokens.
// OpenAI format: [{ type: "function", function: {...} }].
export const getToolSchemas = (user) => toolNamesFor(user).map((n) => SCHEMAS[n]);

// Same tools in Gemini's format: [{ functionDeclarations: [{ name, description, parameters? }] }].
// Parameters are omitted when a tool takes no arguments (Gemini rejects empty objects).
export const getGeminiTools = (user) => {
  const functionDeclarations = toolNamesFor(user).map((n) => {
    const { name, description, parameters } = SCHEMAS[n].function;
    const hasParams = parameters && Object.keys(parameters.properties || {}).length > 0;
    return hasParams ? { name, description, parameters } : { name, description };
  });
  return [{ functionDeclarations }];
};

export const executeTool = async (name, args, user) => {
  const fn = EXECUTORS[name];
  if (!fn) return { error: "unknown_tool", message: `No such tool: ${name}` };
  try {
    return await fn(args || {}, user);
  } catch (err) {
    return { error: "tool_failed", message: err.message };
  }
};
