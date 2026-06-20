import mongoose from "mongoose";
import { newId } from "../utils/id.util.js";

const socialLinkSchema = new mongoose.Schema(
  { platform: { type: String, default: "" }, url: { type: String, default: "" } },
  { _id: false }
);

// Migrated from the Postgres `affiliate_applications` table. SQL enforced a
// partial unique index on lower(email) WHERE status='pending'; reproduced below
// so a person can't have two pending applications with the same email.
const affiliateApplicationSchema = new mongoose.Schema(
  {
    _id:          { type: String, default: newId },
    full_name:    { type: String, required: true },
    email:        { type: String, required: true },
    phone:        { type: String },
    bio:          { type: String },
    social_links: { type: [socialLinkSchema], default: [] },
    status:       { type: String, default: "pending" }, // 'pending' | 'approved' | 'rejected'
    review_note:  { type: String },
    user_id:      { type: String, default: null },
    reviewed_at:  { type: Date },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: false },
    toJSON:   { virtuals: true, transform: (_, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: true },
  }
);

// Partial unique: one pending application per (lowercased) email.
affiliateApplicationSchema.index(
  { email: 1 },
  {
    unique: true,
    partialFilterExpression: { status: "pending" },
    collation: { locale: "en", strength: 2 }, // case-insensitive
  }
);

export const AffiliateApplication = mongoose.model("AffiliateApplication", affiliateApplicationSchema);
