import mongoose from "mongoose";

// A scheduled live class delivered over Zoom / Google Meet. It is attached to a
// course and, optionally, to a LIVE batch. When a batchId is set the class is
// visible (and attendance taken) only for that batch's students; otherwise it is
// course-wide — visible to every student with an active LIVE enrollment.
const onlineClassSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    courseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
      required: true,
    },
    // Optional LIVE batch this class belongs to. When set, audience + attendance
    // are scoped to the batch's students; when null, the class is course-wide.
    batchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Batch",
      default: null,
    },
    // Assigned instructor — must have an APPROVED teaching request for this course.
    instructorId: {
      type: String, // user id
      required: true,
    },
    // Zoom meeting details
    joinUrl: {
      type: String, // Zoom meeting join link
      required: true,
      trim: true,
    },
    meetingId: {
      type: String, // optional Zoom meeting ID
      default: "",
      trim: true,
    },
    passcode: {
      type: String, // optional Zoom passcode
      default: "",
      trim: true,
    },
    startTime: {
      type: Date,
      required: true,
    },
    durationMins: {
      type: Number, // expected length in minutes
      default: 60,
    },
    status: {
      type: String,
      enum: ["scheduled", "live", "completed", "cancelled"],
      default: "scheduled",
    },
    createdBy: {
      type: String, // admin user id
      required: true,
    },
  },
  { timestamps: true },
);

// Student "upcoming classes for my course" lookups: find({ courseId }).sort({ startTime }).
onlineClassSchema.index({ courseId: 1, startTime: 1 });
// Instructor "my classes" lookups.
onlineClassSchema.index({ instructorId: 1, startTime: 1 });

export const OnlineClass = mongoose.model("OnlineClass", onlineClassSchema);
