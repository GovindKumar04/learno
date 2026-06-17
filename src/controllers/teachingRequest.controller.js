import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import {
  createTeachingRequestService,
  getMyTeachingRequestsService,
  getAllTeachingRequestsService,
  updateTeachingRequestStatusService,
  deleteTeachingRequestService,
} from "../services/teachingRequest.service.js";

// POST /teaching-requests  (instructor)
const createTeachingRequest = asyncHandler(async (req, res) => {
  const { request, reSubmitted } = await createTeachingRequestService({
    instructorId: req.user.id,
    courseId: req.body.courseId,
    mode: req.body.mode,
    message: req.body.message,
  });
  return res
    .status(reSubmitted ? 200 : 201)
    .json(new ApiResponse(reSubmitted ? 200 : 201, request, reSubmitted ? "Teaching request re-submitted" : "Teaching request submitted"));
});

// GET /teaching-requests/my  (instructor)
const getMyTeachingRequests = asyncHandler(async (req, res) => {
  const requests = await getMyTeachingRequestsService(req.user.id);
  return res.json(new ApiResponse(200, requests));
});

// GET /teaching-requests  (admin)
const getAllTeachingRequests = asyncHandler(async (req, res) => {
  const data = await getAllTeachingRequestsService(req.query);
  return res.json(new ApiResponse(200, data));
});

// PATCH /teaching-requests/:id  (admin)
const updateTeachingRequestStatus = asyncHandler(async (req, res) => {
  const request = await updateTeachingRequestStatusService({
    id: req.params.id,
    status: req.body.status,
    reviewerId: req.user.id,
  });
  return res.json(new ApiResponse(200, request, `Request ${request.status}`));
});

// DELETE /teaching-requests/:id  (admin removes; instructor withdraws their own)
const deleteTeachingRequest = asyncHandler(async (req, res) => {
  const result = await deleteTeachingRequestService({ id: req.params.id, user: req.user, password: req.body?.password });
  const message = result.deleted ? "Teaching request removed" : "Teaching request withdrawn";
  return res.json(new ApiResponse(200, result, message));
});

export {
  createTeachingRequest,
  getMyTeachingRequests,
  getAllTeachingRequests,
  updateTeachingRequestStatus,
  deleteTeachingRequest,
};
