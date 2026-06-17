import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import {
  createModuleService,
  getModulesService,
  updateModuleService,
  deleteModuleService,
} from "../services/module.service.js";

// POST /api/courses/:courseId/modules
const createModule = asyncHandler(async (req, res) => {
  const mod = await createModuleService({ courseId: req.params.courseId, ...req.body });
  return res.status(201).json(new ApiResponse(201, mod, "Module created successfully"));
});

// GET /api/courses/:courseId/modules
const getModules = asyncHandler(async (req, res) => {
  const modules = await getModulesService({ courseId: req.params.courseId, user: req.user });
  return res.json(new ApiResponse(200, modules));
});

// PATCH /api/courses/:courseId/modules/:moduleId
const updateModule = asyncHandler(async (req, res) => {
  const mod = await updateModuleService({
    courseId: req.params.courseId,
    moduleId: req.params.moduleId,
    updates: req.body,
  });
  return res.json(new ApiResponse(200, mod, "Module updated successfully"));
});

// DELETE /api/courses/:courseId/modules/:moduleId
const deleteModule = asyncHandler(async (req, res) => {
  await deleteModuleService({
    courseId: req.params.courseId,
    moduleId: req.params.moduleId,
    password: req.body?.password,
    adminId: req.user.id,
  });
  return res.json(new ApiResponse(200, null, "Module deleted successfully"));
});

export { createModule, getModules, updateModule, deleteModule };
