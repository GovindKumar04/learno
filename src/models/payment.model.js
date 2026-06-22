import mongoose from "mongoose";
import { newId } from "../utils/id.util.js";

// Razorpay payments. `amount` is stored in paise (integer). course_id is a
// Course _id string.
const paymentSchema = new mongoose.Schema(
  {
    _id:                 { type: String, default: newId },
    user_id:             { type: String, required: true },
    course_id:           { type: String, required: true },
    course_title:        { type: String, required: true },
    enrollment_type:     { type: String, default: "self-paced" },
    amount:              { type: Number, required: true },
    currency:            { type: String, default: "INR" },
    razorpay_order_id:   { type: String, required: true, unique: true },
    razorpay_payment_id: { type: String },
    razorpay_signature:  { type: String },
    status:              { type: String, default: "pending" },
    paid_at:             { type: Date },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    toJSON:   { virtuals: true, transform: (_, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: true },
  }
);

paymentSchema.index({ user_id: 1 });
paymentSchema.index({ status: 1 });
paymentSchema.index({ created_at: -1 });

export const Payment = mongoose.model("Payment", paymentSchema);
