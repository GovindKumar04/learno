import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import {
  getOnlineClassOptionsService,
  createOnlineClassService,
  getAllOnlineClassesService,
  getInstructorOnlineClassesService,
  getStudentOnlineClassesService,
  updateOnlineClassService,
  deleteOnlineClassService,
  getLiveClassAttendanceService,
  markLiveClassAttendanceService,
} from "../services/onlineClass.service.js";

// GET /online-classes/course/:courseId/options  (admin)
const getOnlineClassOptions = asyncHandler(async (req, res) => {
  const data = await getOnlineClassOptionsService(req.params.courseId);
  return res.json(new ApiResponse(200, data));
});

// POST /online-classes  (admin)
const createOnlineClass = asyncHandler(async (req, res) => {
  const onlineClass = await createOnlineClassService({ body: req.body, createdBy: req.user.id });
  return res.status(201).json(new ApiResponse(201, onlineClass, "Online class scheduled successfully"));
});

// GET /online-classes  (admin)
const getAllOnlineClasses = asyncHandler(async (req, res) => {
  const data = await getAllOnlineClassesService();
  return res.json(new ApiResponse(200, data));
});

// GET /online-classes/instructor  (instructor)
const getInstructorOnlineClasses = asyncHandler(async (req, res) => {
  const data = await getInstructorOnlineClassesService(req.user.id);
  return res.json(new ApiResponse(200, data));
});

// GET /online-classes/student  (student)
const getStudentOnlineClasses = asyncHandler(async (req, res) => {
  const data = await getStudentOnlineClassesService(req.user.id);
  return res.json(new ApiResponse(200, data));
});

// PATCH /online-classes/:id  (admin)
const updateOnlineClass = asyncHandler(async (req, res) => {
  const onlineClass = await updateOnlineClassService({ id: req.params.id, body: req.body });
  return res.json(new ApiResponse(200, onlineClass, "Online class updated successfully"));
});

// DELETE /online-classes/:id  (admin)
const deleteOnlineClass = asyncHandler(async (req, res) => {
  await deleteOnlineClassService({ id: req.params.id, password: req.body?.password, adminId: req.user.id });
  return res.json(new ApiResponse(200, null, "Online class deleted successfully"));
});

// GET /online-classes/:id/attendance  (instructor/admin)
const getLiveClassAttendance = asyncHandler(async (req, res) => {
  const data = await getLiveClassAttendanceService({ id: req.params.id, user: req.user });
  return res.json(new ApiResponse(200, data));
});

// POST /online-classes/:id/attendance  (instructor/admin)
const markLiveClassAttendance = asyncHandler(async (req, res) => {
  const data = await markLiveClassAttendanceService({ id: req.params.id, records: req.body.records, user: req.user });
  return res.json(new ApiResponse(200, data, "Attendance saved"));
});

export {
  getOnlineClassOptions,
  createOnlineClass,
  getAllOnlineClasses,
  getInstructorOnlineClasses,
  getStudentOnlineClasses,
  updateOnlineClass,
  deleteOnlineClass,
  getLiveClassAttendance,
  markLiveClassAttendance,
};
