import mongoose from "mongoose";

// A record of every certificate Fillip Skill Academy has issued.
// One certificate per student per course (re-issuing updates the same row,
// keeping a stable certificate number).
const certificateSchema = new mongoose.Schema(
  {
    userId: {
      type: String, // portal student id, OR a synthetic "manual:<uuid>" id for
      // certificates typed in by an admin for someone without a portal account.
      required: true,
    },
    courseId: {
      // Optional: a manual certificate may name a course that doesn't exist as a
      // portal Course (admin typed a custom title), in which case only courseName
      // is stored.
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
    },
    // Human-readable certificate id, e.g. FSA-CERT-26-0001 — printed on the PDF.
    certificateNo: {
      type: String,
      required: true,
      unique: true,
    },
    // Snapshot of the names at issue time (so the record is stable even if the
    // user later renames or the course title changes).
    studentName: { type: String, required: true },
    courseName: { type: String, required: true },
    // Optional — a manual certificate for a walk-in / non-portal student may not
    // have an email to deliver to (admin downloads and shares the PDF instead).
    email: { type: String },
    // True when an admin generated this by hand (typed name / course), bypassing
    // the completion-eligibility checks that gate normal issuance.
    isManual: { type: Boolean, default: false },
    // Which certificate template to render: course "completion" (appreciation)
    // or "internship". Drives the title + wording in the PDF.
    type: { type: String, enum: ["completion", "internship"], default: "completion" },
    // Internship duration (optional) — printed as "from … to …" on the PDF.
    fromDate: { type: Date },
    toDate: { type: Date },
    // Internship department (optional) — when set, switches to the
    // "… in <dept> Department as a <domain> Intern …" wording.
    department: { type: String },
    // Signatories: left block has a selectable designation; the right block's
    // role is always "Trainer". Signatures are auto-drawn from these names.
    signatoryName: { type: String },
    signatoryDesignation: { type: String },
    trainerName: { type: String },
    trainerDesignation: { type: String },
    issuedBy: {
      type: String, // admin user id who issued it
      required: true,
    },
    issuedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

// One certificate per student+course. Manual certificates each get a unique
// synthetic userId ("manual:<uuid>"), so they never collide here even when
// courseId is null (custom course title).
certificateSchema.index({ userId: 1, courseId: 1 }, { unique: true });

export const Certificate = mongoose.model("Certificate", certificateSchema);
