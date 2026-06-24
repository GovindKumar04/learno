import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import cloudinary from "../config/cloudinary.js";
import { ApiError } from "../utils/ApiError.js";
import {
  getAllEnquiriesService,
  getEnquiryStatsService,
  getEnquiryByIdService,
  getEnquiryAttachmentService,
  replyToEnquiryService,
  updateEnquiryStatusService,
} from "../services/enquiry.service.js";

// GET /enquiries  — list all with filters
const getAllEnquiries = asyncHandler(async (req, res) => {
  const data = await getAllEnquiriesService(req.query);
  return res.json(new ApiResponse(200, data));
});

// GET /enquiries/stats  — dashboard numbers
const getEnquiryStats = asyncHandler(async (req, res) => {
  const stats = await getEnquiryStatsService();
  return res.json(new ApiResponse(200, stats));
});

// GET /enquiries/:id  — single enquiry with full reply history
const getEnquiryById = asyncHandler(async (req, res) => {
  const data = await getEnquiryByIdService(req.params.id);
  return res.json(new ApiResponse(200, data));
});


const streamEnquiryAttachment = asyncHandler(async (req, res) => {
  const { url, type, publicId, ticketId } = await getEnquiryAttachmentService({
    id: req.params.id,
    index: Number(req.params.index),
  });

  const isPdf = type === "pdf";


  const adminDownload = (resourceType) =>
    cloudinary.utils.private_download_url(publicId, "", { resource_type: resourceType, type: "upload" });

  const candidates = [];
  if (publicId && isPdf) candidates.push(adminDownload("raw"));
  candidates.push(url);
  if (publicId && !isPdf) candidates.push(adminDownload("image"));

  let upstream = null;
  const tried = [];
  for (const candidate of candidates) {
    try {
      const r = await fetch(candidate);
      tried.push(`${r.status} ${candidate}`);
      if (r.ok) { upstream = r; break; }
    } catch (e) {
      tried.push(`ERR ${e.message} ${candidate}`);
    }
  }

  if (!upstream) {
    console.error("Attachment delivery failed:\n  " + tried.join("\n  "));
    throw new ApiError(502, "Could not retrieve the attachment from storage");
  }

  const buffer = Buffer.from(await upstream.arrayBuffer());
  const contentType = isPdf ? "application/pdf" : upstream.headers.get("content-type") || "application/octet-stream";
  const ext = isPdf ? "pdf" : (contentType.split("/")[1] || "bin");
  const disposition = req.query.download ? "attachment" : "inline";

  res.setHeader("Content-Type", contentType);
  res.setHeader("Content-Disposition", `${disposition}; filename="${ticketId || "attachment"}.${ext}"`);
  res.setHeader("Content-Length", buffer.length);
  return res.send(buffer);
});

// POST /enquiries/:id/reply  — admin replies, mail sent to user
const replyToEnquiry = asyncHandler(async (req, res) => {
  const enquiry = await replyToEnquiryService({ id: req.params.id, message: req.body.message });
  return res.json(new ApiResponse(200, enquiry, "Reply sent successfully"));
});

// PATCH /enquiries/:id/status  — update status + optional admin note
const updateEnquiryStatus = asyncHandler(async (req, res) => {
  const enquiry = await updateEnquiryStatusService({ id: req.params.id, ...req.body });
  return res.json(new ApiResponse(200, enquiry, "Enquiry updated successfully"));
});

export {
  getAllEnquiries,
  getEnquiryStats,
  getEnquiryById,
  streamEnquiryAttachment,
  replyToEnquiry,
  updateEnquiryStatus,
};
