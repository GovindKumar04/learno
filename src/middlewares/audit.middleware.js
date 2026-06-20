import { AuditLog } from "../models/auditLog.model.js";

// Records a successful privileged action to audit_log.
//
// Design notes:
//  - Hooks the response 'finish' event so it never adds latency to the request.
//  - Fire-and-forget insert: a logging failure is swallowed (logged to console)
//    so the audit trail can never break the actual operation.
//  - Only successful responses (status < 400) are recorded — this is a "what
//    changed" trail, not a failed-attempt log.

const REDACT = new Set([
  "password", "oldPassword", "newPassword", "currentPassword",
  "token", "razorpay_signature",
]);
const MAX_META_BYTES = 4000; // keep big mail bodies etc. out of the table

const sanitizeBody = (body) => {
  if (!body || typeof body !== "object") return undefined;
  const out = {};
  for (const [k, v] of Object.entries(body)) {
    out[k] = REDACT.has(k) ? "[redacted]" : v;
  }
  return out;
};

// Best-effort target id from the usual route params.
const pickTargetId = (req) =>
  req.params?.enrollmentId ||
  req.params?.id ||
  req.params?.userId ||
  req.params?.courseId ||
  req.params?.code ||
  null;

export const audit = (action) => (req, res, next) => {
  res.on("finish", () => {
    if (res.statusCode >= 400) return;

    let metadata = {
      params: req.params && Object.keys(req.params).length ? req.params : undefined,
      body: sanitizeBody(req.body),
    };
    // Cap stored metadata size (keep big mail bodies etc. out of the collection).
    const metaBytes = JSON.stringify(metadata).length;
    if (metaBytes > MAX_META_BYTES) {
      metadata = { truncated: true, bytes: metaBytes };
    }

    const targetId = pickTargetId(req);

    AuditLog.create({
      actor_id: req.user?.id ?? null,
      actor_role: req.user?.role ?? null,
      action,
      target_id: targetId ? String(targetId) : null,
      metadata,
      ip: req.ip ?? null,
    }).catch((err) => console.error(`audit_log insert failed (${action}):`, err.message));
  });

  next();
};
