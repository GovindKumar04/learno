import mongoose from "mongoose";


const certificateSchema = new mongoose.Schema(
  {
    userId: {
      type: String, 
      
      required: true,
    },
    courseId: {
      
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
    },
    
    certificateNo: {
      type: String,
      required: true,
      unique: true,
    },
    
    studentName: { type: String, required: true },
    courseName: { type: String, required: true },
    
    email: { type: String },

    isManual: { type: Boolean, default: false },
    
    type: { type: String, enum: ["completion", "internship"], default: "completion" },
    
    fromDate: { type: Date },
    toDate: { type: Date },
   
    department: { type: String },
   
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


certificateSchema.index({ userId: 1, courseId: 1 }, { unique: true });

export const Certificate = mongoose.model("Certificate", certificateSchema);
