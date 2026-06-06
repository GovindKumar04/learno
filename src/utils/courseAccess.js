import { Enrollment } from "../models/enrollment.model.js";

// ─────────────────────────────────────────────────────────────────────────────
// Who may view a course's actual material files (video/pdf/image URLs)?
//   - admins (manage content)
//   - students with an ACTIVE ONLINE enrollment in that course
// Offline-enrolled students learn in person and do NOT get the online materials;
// guests / non-enrolled / offline get the curriculum outline only.
// ─────────────────────────────────────────────────────────────────────────────
export async function hasOnlineCourseAccess(user, courseId) {
  if (!user) return false;
  if (user.role === "admin") return true;

  const enrollment = await Enrollment.findOne({
    userId: user.id,
    courseId,
    isActive: true,
  }).select("enrollmentType");

  return !!enrollment && enrollment.enrollmentType === "online";
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
