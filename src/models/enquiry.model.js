// models/enquiry.model.js

import mongoose from "mongoose";

const replySchema = new mongoose.Schema(
  {
    message: {
      type: String,
      required: true,
    },

    sentBy: {
      type: String,
      enum: ["user", "admin"],
      required: true,
    },

    sentAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    _id: false,
  }
);

const enquirySchema = new mongoose.Schema(
  {
    ticketId: {
      type: String,
      unique: true,
    },

    name: {
      type: String,
      required: true,
    },

    email: {
      type: String,
      required: true,
    },

    phone: {
      type: String,
    },

    subject: {
      type: String,
      required: true,
    },

    message: {
      type: String,
      required: true,
    },

    role: {
      type: String,
      enum: ["guest", "student", "instructor"],
      default: "guest",
    },

    status: {
      type: String,
      enum: ["open", "pending", "contacted", "resolved"],
      default: "open",
    },

    priority: {
      type: String,
      enum: ["low", "medium", "high", "urgent"],
      default: "medium",
    },

    category: {
      type: String,
      enum: ["course_issue", "payment", "general", "technical", "internship"],
      default: "general",
    },

    attachments: [
      {
        url:      { type: String, required: true },
        publicId: { type: String, required: true },
        type:     { type: String, enum: ["image", "pdf"], default: "image" },
      },
    ],

    adminNote: {
      type: String,
    },

    replies: [replySchema],

    respondedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);


// Auto generate ticket ID before saving
enquirySchema.pre("save", async function () {
  if (!this.ticketId) {
    const count = await mongoose.model("Enquiry").countDocuments();

    this.ticketId = `TKT-${String(count + 1).padStart(4, "0")}`;
  }
});

export const Enquiry = mongoose.model(
  "Enquiry",
  enquirySchema
);