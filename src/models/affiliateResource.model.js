import mongoose from "mongoose";
import { newId } from "../utils/id.util.js";


const affiliateResourceSchema = new mongoose.Schema(
  {
    _id:         { type: String, default: newId },
    title:       { type: String, required: true },
    description: { type: String },
    url:         { type: String, required: true },
    is_active:   { type: Boolean, default: true },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    toJSON:   { virtuals: true, transform: (_, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: true },
  }
);

export const AffiliateResource = mongoose.model("AffiliateResource", affiliateResourceSchema);
