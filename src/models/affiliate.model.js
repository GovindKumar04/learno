import mongoose from "mongoose";
import { newId } from "../utils/id.util.js";

const socialLinkSchema = new mongoose.Schema(
  { platform: { type: String, default: "" }, url: { type: String, default: "" } },
  { _id: false }
);


const affiliateSchema = new mongoose.Schema(
  {
    _id:              { type: String, default: newId },
    user_id:          { type: String, required: true, unique: true },
    code:             { type: String, required: true, unique: true },
    commission_type:  { type: String, default: "percent" }, // 'percent' | 'flat'
    commission_value: { type: Number, default: 10 },
    status:           { type: String, default: "active" },   // 'active' | 'suspended'
    clicks:           { type: Number, default: 0 },
    bio:              { type: String },
    social_links:     { type: [socialLinkSchema], default: [] },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    toJSON:   { virtuals: true, transform: (_, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: true },
  }
);

export const Affiliate = mongoose.model("Affiliate", affiliateSchema);
