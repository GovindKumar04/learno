import express from "express";

import {
  getContactInfo,
  sendEnquiry,
} from "../controllers/contact.controller.js";

import { optionalAuth } from "../middlewares/optionalAuth.middleware.js";

const contactRouter = express.Router();


// GET /api/contact/info
// Guest users + logged-in users both allowed
contactRouter.get(
  "/info",
  optionalAuth,
  getContactInfo
);


// POST /api/contact/enquiry
// Guest users + logged-in users both allowed
contactRouter.post(
  "/enquiry",
  optionalAuth,
  sendEnquiry
);

export { contactRouter };