import mongoose from "mongoose";

const teachingRequestSchema = new mongoose.Schema(
  {
    instructorId: {
      type: String, // user id (role = instructor)
      required: true,
    },
    courseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
      required: true,
    },
    message: {
      type: String,
      trim: true,
      default: "",
    },
    // The delivery mode this request is for. An instructor applies once per mode,
    // so they can teach the same course in several modes via separate requests.
    //   self-paced → recorded course content
    //   classroom  → in-person batches
    //   live       → Zoom / Google Meet classes
    mode: {
      type: String,
      enum: ["self-paced", "classroom", "live"],
      default: "classroom",
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected", "withdrawn"],
      default: "pending",
    },
    reviewedBy: {
      type: String, // admin user id who approved/rejected
      default: null,
    },
    reviewedAt: {
      type: Date,
      default: null,
    },
    // When the instructor withdrew their own request. Drives a re-apply hold
    // (they can't request the same course again until HOLD_DAYS have passed).
    withdrawnAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true },
);

// One request per instructor+course+mode (re-request handled by re-opening the row).
// An instructor can hold separate requests for different modes of the same course.
teachingRequestSchema.index({ instructorId: 1, courseId: 1, mode: 1 }, { unique: true });

export const TeachingRequest = mongoose.model("TeachingRequest", teachingRequestSchema);
