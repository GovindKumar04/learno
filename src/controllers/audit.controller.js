import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { getAuditLogsService } from "../services/audit.service.js";

// GET /audit-logs  (admin) — ?page&limit&action&actorId
const getAuditLogs = asyncHandler(async (req, res) => {
  const data = await getAuditLogsService(req.query);
  return res.json(new ApiResponse(200, data));
});

export { getAuditLogs };
