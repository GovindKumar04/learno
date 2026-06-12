import pool from "../config/db.js";

// Admin-only: paginated, newest-first view of the audit trail, optionally
// filtered by action or actor. Joins users so the UI can show who acted.
export const getAuditLogsService = async ({ page = 1, limit = 50, action, actorId } = {}) => {
  const pageNum = Math.max(1, Number(page) || 1);
  const limitNum = Math.min(200, Math.max(1, Number(limit) || 50));

  const conditions = [];
  const params = [];
  if (action) {
    params.push(action);
    conditions.push(`a.action = $${params.length}`);
  }
  if (actorId) {
    params.push(actorId);
    conditions.push(`a.actor_id = $${params.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const totalResult = await pool.query(`SELECT COUNT(*)::int AS total FROM audit_log a ${where}`, params);
  const total = totalResult.rows[0].total;

  params.push(limitNum, (pageNum - 1) * limitNum);
  const rows = await pool.query(
    `SELECT a.id, a.actor_id, a.actor_role, a.action, a.target_id, a.metadata, a.ip, a.created_at,
            u.full_name AS actor_name, u.email AS actor_email
       FROM audit_log a
       LEFT JOIN users u ON u.id = a.actor_id
       ${where}
       ORDER BY a.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  return { logs: rows.rows, total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) };
};
