import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import {
  getBatchOptionsService,
  createBatchService,
  getAllBatchesService,
  getMyBatchesService,
  updateBatchService,
  deleteBatchService,
} from "../services/batch.service.js";

// GET /batches/course/:courseId/options?mode=classroom|live  (admin)
const getBatchOptions = asyncHandler(async (req, res) => {
  const data = await getBatchOptionsService(req.params.courseId, req.query.mode);
  return res.json(new ApiResponse(200, data));
});

// POST /batches  (admin)
const createBatch = asyncHandler(async (req, res) => {
  const batch = await createBatchService({ body: req.body, createdBy: req.user.id });
  return res.status(201).json(new ApiResponse(201, batch, "Batch created successfully"));
});

// GET /batches  (admin)
const getAllBatches = asyncHandler(async (req, res) => {
  const data = await getAllBatchesService();
  return res.json(new ApiResponse(200, data));
});

// GET /batches/my  (instructor)
const getMyBatches = asyncHandler(async (req, res) => {
  const data = await getMyBatchesService(req.user.id);
  return res.json(new ApiResponse(200, data));
});

// PATCH /batches/:id  (admin)
const updateBatch = asyncHandler(async (req, res) => {
  const batch = await updateBatchService({ id: req.params.id, body: req.body });
  return res.json(new ApiResponse(200, batch, "Batch updated successfully"));
});

// DELETE /batches/:id  (admin)
const deleteBatch = asyncHandler(async (req, res) => {
  await deleteBatchService({ id: req.params.id, password: req.body?.password, adminId: req.user.id });
  return res.json(new ApiResponse(200, null, "Batch deleted successfully"));
});

export { getBatchOptions, createBatch, getAllBatches, getMyBatches, updateBatch, deleteBatch };
