import mongoose from "mongoose";
import { newId } from "../utils/id.util.js";

// Migrated from the Postgres `users` table. Field names are kept snake_case and
// the UUIDv7 lives in `_id` (String) so every existing cross-store reference
// (referred_by, payments.user_id, enrollments.userId, …) stays valid and the
// frontend/JWT contract is unchanged. Mongoose's built-in `id` virtual returns
// `_id` as a string, so `user.id` keeps working.
const userSchema = new mongoose.Schema(
  {
    _id:                        { type: String, default: newId },
    full_name:                  { type: String, required: true },
    email:                      { type: String, required: true, unique: true },
    roll_number:                { type: String, unique: true, sparse: true },
    password:                   { type: String },
    role:                       { type: String, default: "student" },
    location:                   { type: String },
    phone:                      { type: String },
    refresh_token:              { type: String },
    avatar:                     { type: String },
    is_verified:                { type: Boolean, default: false },
    is_active:                  { type: Boolean, default: true },
    referred_by:                { type: String, default: null },
    verification_code:          { type: String },
    verification_code_expires:  { type: Date },
    reset_code:                 { type: String },
    reset_code_expires:         { type: Date },
    google_id:                  { type: String },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    toJSON:   { virtuals: true, transform: (_, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: true },
  }
);

userSchema.index({ role: 1 });
userSchema.index({ referred_by: 1 });

export const User = mongoose.model("User", userSchema);
