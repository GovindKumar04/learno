import { AuditLog } from "../models/auditLog.model.js";
import { buildUserMap } from "../utils/userQuery.util.js";

// Admin-only: paginated, newest-first view of the audit trail, optionally
// filtered by action or actor. Enriches with the actor's name/email for the UI.
export const getAuditLogsService = async ({ page = 1, limit = 50, action, actorId } = {}) => {
  const pageNum = Math.max(1, Number(page) || 1);
  const limitNum = Math.min(200, Math.max(1, Number(limit) || 50));

  const filter = {};
  if (action) filter.action = action;
  if (actorId) filter.actor_id = actorId;

  const [total, docs] = await Promise.all([
    AuditLog.countDocuments(filter),
    AuditLog.find(filter).sort({ created_at: -1 }).skip((pageNum - 1) * limitNum).limit(limitNum).lean(),
  ]);

  const userMap = await buildUserMap(
    [...new Set(docs.map((d) => d.actor_id).filter(Boolean))],
    "full_name email"
  );

  const logs = docs.map((d) => {
    const u = userMap[d.actor_id] || {};
    return {
      id: d._id,
      actor_id: d.actor_id,
      actor_role: d.actor_role,
      action: d.action,
      target_id: d.target_id,
      metadata: d.metadata,
      ip: d.ip,
      created_at: d.created_at,
      actor_name: u.full_name || null,
      actor_email: u.email || null,
    };
  });

  return { logs, total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) };
};
