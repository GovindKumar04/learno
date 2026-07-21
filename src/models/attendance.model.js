import mongoose from "mongoose";


const recordSchema = new mongoose.Schema(
  {
    studentId: { type: String, required: true }, 
    status: {
      type: String,
      enum: ["present", "absent", "leave"],
      default: "present",
    },
  },
  { _id: false },
);


const attendanceSchema = new mongoose.Schema(
  {

    batchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Batch",
    },

    onlineClassId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "OnlineClass",
    },
    courseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
    },
    
    date: {
      type: String,
      required: true,
    },
    records: [recordSchema],
    markedBy: {
      type: String, 
      required: true,
    },
  },
  { timestamps: true },
);


attendanceSchema.index(
  { batchId: 1, date: 1 },
  { unique: true, partialFilterExpression: { batchId: { $exists: true } } },
);


attendanceSchema.index(
  { onlineClassId: 1 },
  { unique: true, partialFilterExpression: { onlineClassId: { $exists: true } } },
);

export const Attendance = mongoose.model("Attendance", attendanceSchema);
