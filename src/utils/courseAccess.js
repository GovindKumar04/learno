import { Enrollment } from "../models/enrollment.model.js";

// ─────────────────────────────────────────────────────────────────────────────
// Who may view a course's actual material files (video/pdf/image URLs)?
//   - admins (manage content)
//   - students with an ACTIVE SELF-PACED enrollment in that course
// Classroom learners attend in person and Live learners attend Zoom/Meet sessions;
// neither gets the recorded materials. Guests / non-enrolled / classroom / live
// get the curriculum outline only.
// ─────────────────────────────────────────────────────────────────────────────
export async function hasOnlineCourseAccess(user, courseId) {
  if (!user) return false;
  if (user.role === "admin") return true;

  const enrollment = await Enrollment.findOne({
    userId: user.id,
    courseId,
    isActive: true,
  }).select("enrollmentType");

  return !!enrollment && enrollment.enrollmentType === "self-paced";
}

// Remove the streamable/downloadable fields (url, publicId) from populated
// materials, leaving the outline (title, type, duration). Marks each material
// `locked: true` so the client can show a lock state. Operates on an array of
// PLAIN module objects (call .toObject() first) and mutates it in place.
export function stripMaterialUrls(modules = []) {
  for (const mod of modules) {
    if (Array.isArray(mod.materials)) {
      mod.materials = mod.materials.map((mat) => {
        const { url, publicId, ...rest } = mat;
        return { ...rest, locked: true };
      });
    }
  }
  return modules;
}
