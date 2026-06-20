import { Batch } from "../models/batch.model.js";
import { Course } from "../models/course.model.js";
import { Enrollment } from "../models/enrollment.model.js";
import { TeachingRequest } from "../models/teachingRequest.model.js";
import { Attendance } from "../models/attendance.model.js";
import { OnlineClass } from "../models/onlineClass.model.js";
import { ApiError } from "../utils/ApiError.js";
import { sendBatchAssignmentMail } from "../utils/mail.util.js";
import { isUuid } from "../utils/id.util.js";
import { verifyAdminPassword, assertNoDependents } from "../utils/deleteGuard.util.js";
import { buildUserMap } from "../utils/userQuery.util.js";

// Fetch { id → user } map for a list of UUIDs.
async function fetchUsersMap(ids) {
  const unique = [...new Set(ids.filter(isUuid))];
  return buildUserMap(unique, "full_name email phone role");
}

// Email the time + location to the assigned instructor and students.
async function notifyBatchAssignment(batch) {
  const course = await Course.findById(batch.courseId).select("title");
  const usersMap = await fetchUsersMap([batch.instructorId, ...(batch.studentIds || [])]);
  const recipients = [usersMap[batch.instructorId], ...(batch.studentIds || []).map((id) => usersMap[id])];

  await Promise.allSettled(
    recipients
      .filter((u) => u && u.email)
      .map((u) =>
        sendBatchAssignmentMail({
          name: u.full_name || "there",
          email: u.email,
          role: u.role,
          courseName: course?.title || "your course",
          batchName: batch.name,
          schedule: batch.schedule,
          location: batch.location,
        })
      )
  );
}

// Shared validation: instructor approved + students enrolled in the batch's mode
async function validateAssignment(courseId, instructorId, studentIds = [], mode = "classroom") {
  const course = await Course.findById(courseId).select("_id");
  if (!course) throw new ApiError(404, "Course not found");

  const approved = await TeachingRequest.findOne({ courseId, instructorId, mode, status: "approved" });
  if (!approved) throw new ApiError(400, `Instructor must have an approved ${mode} teaching request for this course`);

  if (studentIds.length > 0) {
    const validCount = await Enrollment.countDocuments({
      courseId,
      userId: { $in: studentIds },
      enrollmentType: mode,
      isActive: true,
    });
    if (validCount !== studentIds.length) {
      throw new ApiError(400, `All students must be ${mode}-enrolled in this course`);
    }
  }
}

export const getBatchOptionsService = async (courseId, mode = "classroom") => {
  const course = await Course.findById(courseId).select("title");
  if (!course) throw new ApiError(404, "Course not found");

  const enrollmentType = mode === "live" ? "live" : "classroom";
  const [approvedReqs, enrollments] = await Promise.all([
    TeachingRequest.find({ courseId, mode: enrollmentType, status: "approved" }).select("instructorId"),
    Enrollment.find({ courseId, enrollmentType, isActive: true }).select("userId"),
  ]);

  const usersMap = await fetchUsersMap([
    ...approvedReqs.map((r) => r.instructorId),
    ...enrollments.map((e) => e.userId),
  ]);

  const instructors = approvedReqs
    .map((r) => usersMap[r.instructorId])
    .filter(Boolean)
    .map((u) => ({ id: u.id, full_name: u.full_name, email: u.email }));

  const students = enrollments
    .map((e) => usersMap[e.userId])
    .filter(Boolean)
    .map((u) => ({ id: u.id, full_name: u.full_name, email: u.email }));

  return { course: { id: course._id, title: course.title }, instructors, students };
};

export const createBatchService = async ({ body, createdBy }) => {
  const { name, courseId, instructorId, studentIds = [], schedule = "", location = "", seats = 0, status = "upcoming", mode = "classroom" } = body;
  if (!name || !courseId || !instructorId) throw new ApiError(400, "name, courseId, and instructorId are required");
  const batchMode = mode === "live" ? "live" : "classroom";

  await validateAssignment(courseId, instructorId, studentIds, batchMode);

  const batch = await Batch.create({ name, courseId, instructorId, studentIds, schedule, location, seats, status, mode: batchMode, createdBy });
  await notifyBatchAssignment(batch);
  return batch;
};

export const getAllBatchesService = async () => {
  const batches = await Batch.find({}).populate("courseId", "title category").sort({ createdAt: -1 });
  const usersMap = await fetchUsersMap(batches.flatMap((b) => [b.instructorId, ...(b.studentIds || [])]));

  return batches.map((b) => ({
    id: b._id,
    name: b.name,
    course: b.courseId,
    instructor: usersMap[b.instructorId] || { id: b.instructorId },
    students: (b.studentIds || []).map((id) => usersMap[id] || { id }),
    studentCount: (b.studentIds || []).length,
    schedule: b.schedule,
    location: b.location,
    mode: b.mode,
    seats: b.seats,
    status: b.status,
    createdAt: b.createdAt,
  }));
};

export const getMyBatchesService = async (instructorId) => {
  const batches = await Batch.find({ instructorId })
    .populate("courseId", "title category thumbnail slug")
    .sort({ createdAt: -1 });
  const usersMap = await fetchUsersMap(batches.flatMap((b) => b.studentIds || []));

  return batches.map((b) => ({
    id: b._id,
    name: b.name,
    course: b.courseId,
    students: (b.studentIds || []).map((id) => usersMap[id] || { id }),
    studentCount: (b.studentIds || []).length,
    schedule: b.schedule,
    location: b.location,
    mode: b.mode,
    seats: b.seats,
    status: b.status,
  }));
};

export const updateBatchService = async ({ id, body }) => {
  const batch = await Batch.findById(id);
  if (!batch) throw new ApiError(404, "Batch not found");

  const { name, instructorId, studentIds, schedule, location, seats, status } = body;
  const courseId = batch.courseId; // course is fixed once created

  if (instructorId !== undefined || studentIds !== undefined) {
    await validateAssignment(courseId, instructorId ?? batch.instructorId, studentIds ?? batch.studentIds, batch.mode);
  }

  const shouldNotify =
    instructorId !== undefined || studentIds !== undefined || schedule !== undefined || location !== undefined;

  if (name !== undefined) batch.name = name;
  if (instructorId !== undefined) batch.instructorId = instructorId;
  if (studentIds !== undefined) batch.studentIds = studentIds;
  if (schedule !== undefined) batch.schedule = schedule;
  if (location !== undefined) batch.location = location;
  if (seats !== undefined) batch.seats = seats;
  if (status !== undefined) batch.status = status;

  await batch.save();
  if (shouldNotify) await notifyBatchAssignment(batch);
  return batch;
};

export const deleteBatchService = async ({ id, password, adminId }) => {
  await verifyAdminPassword(adminId, password);

  const batch = await Batch.findById(id);
  if (!batch) throw new ApiError(404, "Batch not found");

  // Block while attendance has been recorded or a live class points at this batch.
  const [attendance, onlineClasses] = await Promise.all([
    Attendance.countDocuments({ batchId: id }),
    OnlineClass.countDocuments({ batchId: id }),
  ]);
  assertNoDependents("batch", [
    { label: "attendance session(s)", count: attendance },
    { label: "live class(es) linked to it", count: onlineClasses },
  ]);

  await Batch.findByIdAndDelete(id);
};
