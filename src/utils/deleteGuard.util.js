import bcrypt from "bcrypt";
import { User } from "../models/user.model.js";
import { ApiError } from "./ApiError.js";

// Re-authenticate the acting user by their account password before a destructive
// delete. Throws 400 if no password supplied, 401 if it doesn't match.
export async function verifyAdminPassword(userId, password) {
  if (!password || typeof password !== "string") {
    throw new ApiError(400, "Your account password is required to confirm this deletion.");
  }
  const user = await User.findById(userId).select("password").lean();
  if (!user) throw new ApiError(404, "Account not found.");
  const ok = user.password ? await bcrypt.compare(password, user.password) : false;
  if (!ok) throw new ApiError(401, "Incorrect password — deletion cancelled.");
}

// Block a delete when dependent records still reference this entity.
// blockers: [{ label, count }]. Throws 409 listing what must be removed first.
export function assertNoDependents(entityLabel, blockers) {
  const active = blockers.filter((b) => b.count > 0);
  if (active.length === 0) return;
  const parts = active.map((b) => `${b.count} ${b.label}`).join(", ");
  throw new ApiError(
    409,
    `Can't delete this ${entityLabel} yet — it still has ${parts}. Please delete ${active.length === 1 ? "that" : "those"} first.`,
  );
}

// Escape a user-supplied string so it can be used safely as a literal inside a
// MongoDB $regex (prevents NoSQL-regex injection / ReDoS).
export function escapeRegex(str = "") {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
