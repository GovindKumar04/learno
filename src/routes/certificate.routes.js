import express from "express";
import {
  getEligibleStudents,
  issueCertificates,
  getIssuedCertificates,
} from "../controllers/certificate.controller.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";
import { requireRole } from "../middlewares/role.middleware.js";
import { audit } from "../middlewares/audit.middleware.js";

const certificateRouter = express.Router();

certificateRouter.use(verifyJWT);

// Admin: students who completed a course (certificate-eligible)
certificateRouter.get("/eligible", requireRole("admin"), getEligibleStudents);

// Admin: issue + email certificates (single or bulk)
certificateRouter.post("/issue", requireRole("admin"), audit("certificate.issue"), issueCertificates);

// Admin: list issued certificates
certificateRouter.get("/", requireRole("admin"), getIssuedCertificates);

export { certificateRouter };
