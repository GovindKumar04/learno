import express from "express";
import {
  applyAffiliate,
  getMyAffiliate,
  trackClick,
  getApplications,
  reviewApplication,
  getResources,
  createResource,
  updateResource,
  deleteResource,
  getAllAffiliates,
  updateAffiliate,
  getCommissions,
  updateCommissionStatus,
} from "../controllers/affiliate.controller.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";
import { requireRole } from "../middlewares/role.middleware.js";
import { audit } from "../middlewares/audit.middleware.js";

const affiliateRouter = express.Router();

// Public — referral link click tracking + third-party applications (no auth)
affiliateRouter.get("/track/:code", trackClick);
affiliateRouter.post("/apply", applyAffiliate);

// Everything below requires login
affiliateRouter.use(verifyJWT);

// Any logged-in user — view own affiliate dashboard
affiliateRouter.get("/me", getMyAffiliate);

// Resources — affiliates read, admin manages
affiliateRouter.get("/resources", requireRole("admin", "affiliate"), getResources);
affiliateRouter.post("/resources", requireRole("admin"), createResource);
affiliateRouter.patch("/resources/:id", requireRole("admin"), updateResource);
affiliateRouter.delete("/resources/:id", requireRole("admin"), deleteResource);

// Admin — manage applications, affiliates & commissions
// (specific routes declared before /:userId to avoid capture)
affiliateRouter.get("/", requireRole("admin"), getAllAffiliates);
affiliateRouter.get("/applications", requireRole("admin"), getApplications);
affiliateRouter.patch("/applications/:id", requireRole("admin"), audit("affiliate.application.review"), reviewApplication);
affiliateRouter.get("/commissions", requireRole("admin"), getCommissions);
affiliateRouter.patch("/commissions/:id", requireRole("admin"), audit("affiliate.commission.update"), updateCommissionStatus);
affiliateRouter.patch("/:userId", requireRole("admin"), audit("affiliate.update"), updateAffiliate);

export { affiliateRouter };
