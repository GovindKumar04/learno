import mongoose from "mongoose";

const batchSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    courseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
      required: true,
    },

    instructorId: {
      type: String, // user id
      required: true,
    },
    
    studentIds: [
      {
        type: String, 
      },
    ],
    schedule: {
      type: String, 
      default: "",
    },
    location: {
      type: String, 
      default: "",
    },
    
    mode: {
      type: String,
      enum: ["classroom", "live"],
      default: "classroom",
    },
    seats: {
      type: Number,
      default: 0,
    },
    status: {
      type: String,
      enum: ["upcoming", "ongoing", "completed"],
      default: "upcoming",
    },
    createdBy: {
      type: String, 
      required: true,
    },
  },
  { timestamps: true },
);

export const Batch = mongoose.model("Batch", batchSchema);
