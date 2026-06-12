import express from "express";
import { getAuditLogs } from "../controllers/audit.controller.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";
import { requireRole } from "../middlewares/role.middleware.js";

const auditRouter = express.Router();

// Admin-only: read the audit trail.
auditRouter.get("/", verifyJWT, requireRole("admin"), getAuditLogs);

export { auditRouter };
