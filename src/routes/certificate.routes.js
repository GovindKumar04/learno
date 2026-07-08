import express from "express";
import {
  getEligibleStudents,
  issueCertificates,
  issueManualCertificate,
  getManualCertificates,
  downloadCertificateById,
  getIssuedCertificates,
  downloadCertificate,
  getMyCertificates,
  downloadMyCertificate,
} from "../controllers/certificate.controller.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";
import { requireRole } from "../middlewares/role.middleware.js";
import { audit } from "../middlewares/audit.middleware.js";

const certificateRouter = express.Router();

certificateRouter.use(verifyJWT);

// Student: my issued certificates + download one (ownership enforced in service).
certificateRouter.get("/my", getMyCertificates);
certificateRouter.get("/my/:id/download", downloadMyCertificate);

// Admin: students who completed a course (certificate-eligible)
certificateRouter.get("/eligible", requireRole("admin"), getEligibleStudents);

// Admin: issue + email certificates (single or bulk)
certificateRouter.post("/issue", requireRole("admin"), audit("certificate.issue"), issueCertificates);

// Admin: generate for any name/course, bypassing eligibility (manual override)
certificateRouter.post("/manual", requireRole("admin"), audit("certificate.manual"), issueManualCertificate);

// Admin: log of manually issued certificates
certificateRouter.get("/manual", requireRole("admin"), getManualCertificates);

// Admin: download an issued certificate PDF by (userId, courseId)
certificateRouter.get("/download", requireRole("admin"), downloadCertificate);

// Admin: list issued certificates
certificateRouter.get("/", requireRole("admin"), getIssuedCertificates);

// Admin: re-download any certificate PDF by id (kept last — param route)
certificateRouter.get("/:id/download", requireRole("admin"), downloadCertificateById);

export { certificateRouter };
