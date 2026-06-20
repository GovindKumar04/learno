import express from "express";
import {
  getAllEnquiries,
  getEnquiryStats,
  getEnquiryById,
  streamEnquiryAttachment,
  replyToEnquiry,
  updateEnquiryStatus,
} from "../controllers/enquiry.controller.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";
import { requireRole } from "../middlewares/role.middleware.js";

const enquiryRouter = express.Router();

// All enquiry portal routes → admin only
enquiryRouter.use(verifyJWT);
enquiryRouter.use(requireRole("admin"));

enquiryRouter.get("/",            getAllEnquiries);
enquiryRouter.get("/stats",       getEnquiryStats);
enquiryRouter.get("/:id",         getEnquiryById);
enquiryRouter.get("/:id/attachment/:index", streamEnquiryAttachment);
enquiryRouter.post("/:id/reply",  replyToEnquiry);
enquiryRouter.patch("/:id/status", updateEnquiryStatus);

export { enquiryRouter };