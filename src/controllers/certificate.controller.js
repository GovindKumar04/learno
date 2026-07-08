import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import {
  getEligibleStudentsService,
  issueCertificatesService,
  issueManualCertificateService,
  getManualCertificatesService,
  getCertificatePdfByIdService,
  getIssuedCertificatesService,
  getCertificatePdfService,
  getMyCertificatesService,
  getMyCertificatePdfService,
} from "../services/certificate.service.js";

// Stream a generated PDF buffer to the client as a file download.
const sendPdf = (res, { pdfBuffer, fileName }) => {
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
  res.setHeader("Content-Length", pdfBuffer.length);
  return res.send(pdfBuffer);
};

// GET /certificates/eligible  (admin only)
const getEligibleStudents = asyncHandler(async (req, res) => {
  const data = await getEligibleStudentsService();
  return res.json(new ApiResponse(200, data));
});

// POST /certificates/issue  (admin only) — Body: { items: [{ userId, courseId }] }
const issueCertificates = asyncHandler(async (req, res) => {
  const result = await issueCertificatesService({ items: req.body.items, issuedBy: req.user.id });
  return res.json(
    new ApiResponse(
      200,
      result,
      `Certificate issued to ${result.sent} student(s)${result.failed ? `, ${result.failed} failed` : ""}`
    )
  );
});

// POST /certificates/manual  (admin only) — generate for any name + any course,
// bypassing eligibility. Body: { studentName, email?, courseId?, courseName? }
const issueManualCertificate = asyncHandler(async (req, res) => {
  const {
    studentName, email, courseId, courseName, type, fromDate, toDate, department,
    signatoryName, signatoryDesignation, trainerName, trainerDesignation,
  } = req.body;
  const result = await issueManualCertificateService({
    studentName,
    email,
    courseId,
    courseName,
    type,
    fromDate,
    toDate,
    department,
    signatoryName,
    signatoryDesignation,
    trainerName,
    trainerDesignation,
    issuedBy: req.user.id,
  });
  const label = result.type === "internship" ? "Internship certificate" : "Certificate";
  return res.json(
    new ApiResponse(
      200,
      result,
      `${label} ${result.certificateNo} generated${result.emailed ? ` and emailed to ${result.email}` : ""}`
    )
  );
});

// GET /certificates/manual  (admin only) — log of manually issued certificates.
// Optional ?type=internship|completion filter.
const getManualCertificates = asyncHandler(async (req, res) => {
  const data = await getManualCertificatesService({ type: req.query.type });
  return res.json(new ApiResponse(200, data));
});

// GET /certificates/:id/download  (admin only) — re-download any certificate PDF
const downloadCertificateById = asyncHandler(async (req, res) => {
  const file = await getCertificatePdfByIdService({ id: req.params.id });
  return sendPdf(res, file);
});

// GET /certificates  (admin only)
const getIssuedCertificates = asyncHandler(async (req, res) => {
  const data = await getIssuedCertificatesService();
  return res.json(new ApiResponse(200, data));
});

// GET /certificates/download?userId=&courseId=  (admin only) — download the PDF
const downloadCertificate = asyncHandler(async (req, res) => {
  const file = await getCertificatePdfService({
    userId: req.query.userId,
    courseId: req.query.courseId,
  });
  return sendPdf(res, file);
});

// GET /certificates/my  (student) — certificates issued to the logged-in user
const getMyCertificates = asyncHandler(async (req, res) => {
  const data = await getMyCertificatesService({ userId: req.user.id });
  return res.json(new ApiResponse(200, data));
});

// GET /certificates/my/:id/download  (student) — download one of my certificates
const downloadMyCertificate = asyncHandler(async (req, res) => {
  const file = await getMyCertificatePdfService({ userId: req.user.id, certId: req.params.id });
  return sendPdf(res, file);
});

export {
  getEligibleStudents,
  issueCertificates,
  issueManualCertificate,
  getManualCertificates,
  downloadCertificateById,
  getIssuedCertificates,
  downloadCertificate,
  getMyCertificates,
  downloadMyCertificate,
};
