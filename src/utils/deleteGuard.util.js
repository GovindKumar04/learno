import bcrypt from "bcrypt";
import pool from "../config/db.js";
import { ApiError } from "./ApiError.js";

// Re-authenticate the acting user by their account password before a destructive
// delete. Throws 400 if no password supplied, 401 if it doesn't match.
export async function verifyAdminPassword(userId, password) {
  if (!password || typeof password !== "string") {
    throw new ApiError(400, "Your account password is required to confirm this deletion.");
  }
  const result = await pool.query("SELECT password FROM users WHERE id = $1", [userId]);
  if (result.rows.length === 0) throw new ApiError(404, "Account not found.");
  const hash = result.rows[0].password;
  const ok = hash ? await bcrypt.compare(password, hash) : false;
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
