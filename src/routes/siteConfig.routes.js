import express from "express";
import { getSiteConfig, getCourseRanking, updateSiteConfig, updateLogo } from "../controllers/siteConfig.controller.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";
import { requireRole } from "../middlewares/role.middleware.js";
import { uploadImage } from "../middlewares/multer.middleware.js";

const siteConfigRouter = express.Router();

siteConfigRouter.get("/", getSiteConfig);
siteConfigRouter.get("/course-ranking", verifyJWT, requireRole("admin"), getCourseRanking);
siteConfigRouter.put("/", verifyJWT, requireRole("admin"), updateSiteConfig);
siteConfigRouter.post("/logo", verifyJWT, requireRole("admin"), uploadImage.single("logo"), updateLogo);

export { siteConfigRouter };
