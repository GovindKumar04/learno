import mongoose from "mongoose";

const reviewSchema = new mongoose.Schema(
  {
    userId: {
      type: String, // PG UUID
      required: true,
    },

    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
    },

    comment: {
      type: String,
      trim: true,
    },

    isFeatured: {
      type: Boolean,
      default: false,
    },

    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false },
);

const courseSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },

    description: {
      type: String,
      required: true,
    },

    thumbnail: {
      type: String,
    },

    thumbnailPublicId: {
      type: String,
    },

    category: {
      type: String,
      required: true,
    },

    level: {
      type: String,
      enum: ["beginner", "intermediate", "advanced"],
      default: "beginner",
    },

    price: {
      type: Number,
      default: 0,
    },

    isPublished: {
      type: Boolean,
      default: false,
    },

    createdBy: {
      type: String, // PG UUID
      required: true,
    },

    modules: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Module",
      },
    ],

    // =========================
    // NEW FIELDS
    // =========================

    prerequisites: [
      {
        type: String,
      },
    ],

    benefits: [
      {
        type: String,
      },
    ],

    targetAudience: [
      {
        type: String,
      },
    ],

    language: {
      type: String,
      default: "English",
    },

    totalDuration: {
      type: Number, // minutes
      default: 0,
    },

    // Number of offline classes this course runs. Used to judge offline
    // course-completion for certificates: a student qualifies once they've
    // attended at least the required % of these classes (see certificate flow).
    totalClasses: {
      type: Number,
      default: 0,
      min: 0,
    },

    // Planned number of LIVE (Zoom/Meet) sessions for this course. Declared
    // before the module starts and editable later. Used as the denominator for
    // live-class attendance and certificate eligibility (mirror of totalClasses
    // for classroom). Attendance summaries recompute automatically when changed.
    totalLiveClasses: {
      type: Number,
      default: 0,
      min: 0,
    },


    totalStudentsEnrolled: {
      type: Number,
      default: 0,
    },

    averageRating: {
      type: Number,
      default: 0,
    },

    totalReviews: {
      type: Number,
      default: 0,
    },

    reviews: [reviewSchema],

    duration: {
      type: String,
      default: "",
    },

    // priceOnline = price for the SELF-PACED mode (field name kept for back-compat).
    priceOnline: {
      type: Number,
      default: 0,
    },

    // priceOffline = price for the CLASSROOM mode (field name kept for back-compat).
    priceOffline: {
      type: Number,
      default: 0,
    },

    // Price for the LIVE (Zoom / Google Meet) mode.
    priceLive: {
      type: Number,
      default: 0,
    },

    // Delivery modes this course is offered in. A course can be offered in any
    // combination of: self-paced (recorded), classroom (in-person), live (Zoom/Meet).
    modes: {
      type: [{ type: String, enum: ["self-paced", "classroom", "live"] }],
      default: ["self-paced", "classroom"],
    },

    demandReasons: [
      {
        type: String,
      },
    ],

    whyChooseUs: [
      {
        title: { type: String },
        description: { type: String },
      },
    ],

    // ── Course-page display fields ──────────────────────────────────────────
    slug: { type: String, unique: true, sparse: true, trim: true },
    tag:      { type: String, default: "" },   // e.g. "#1 MERN Bootcamp"
    subtitle: { type: String, default: "" },
    tagline:  { type: String, default: "" },
    heroImg:  { type: String, default: "" },

    highlights: [
      {
        title: { type: String },
        desc:  { type: String },
      },
    ],

    learnPoints: [{ type: String }],

    industry: {
      title:    { type: String },
      subtitle: { type: String },
      points: [
        {
          icon:  { type: String },
          title: { type: String },
          desc:  { type: String },
        },
      ],
    },

    faqs: [
      {
        q: { type: String },
        a: { type: String },
      },
    ],
  },
  { timestamps: true },
);

// Public catalog only ever queries published courses (often newest-first).
courseSchema.index({ isPublished: 1, createdAt: -1 });

// A course cannot be published without a price assigned on at least one mode.
courseSchema.pre("validate", function () {
  if (this.isPublished) {
    const hasPrice = this.price > 0 || this.priceOnline > 0 || this.priceOffline > 0 || this.priceLive > 0;
    if (!hasPrice) {
      this.invalidate("price", "A course must have a price before it can be published");
    }
  }
});

export const Course = mongoose.model("Course", courseSchema);
