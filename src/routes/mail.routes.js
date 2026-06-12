import express from "express";
import { sendMail } from "../controllers/mail.controller.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";
import { requireRole } from "../middlewares/role.middleware.js";
import { uploadAttachments } from "../middlewares/multer.middleware.js";
import { sensitiveLimiter } from "../middlewares/rateLimit.middleware.js";
import { audit } from "../middlewares/audit.middleware.js";

const mailRouter = express.Router();

mailRouter.use(verifyJWT);

// Admin sends a free-form email with optional attachments
mailRouter.post("/send", requireRole("admin"), sensitiveLimiter, audit("mail.send"), uploadAttachments.array("attachments", 5), sendMail);

export { mailRouter };
