import mongoose from "mongoose";
import { newId } from "../utils/id.util.js";

// Audit log of admin actions. `metadata` is a free-form object (Mixed).
const auditLogSchema = new mongoose.Schema(
  {
    _id:        { type: String, default: newId },
    actor_id:   { type: String, default: null },
    actor_role: { type: String },
    action:     { type: String, required: true },
    target_id:  { type: String },
    metadata:   { type: mongoose.Schema.Types.Mixed },
    ip:         { type: String },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: false },
    toJSON:   { virtuals: true, transform: (_, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: true },
  }
);

auditLogSchema.index({ created_at: -1 });
auditLogSchema.index({ actor_id: 1 });
auditLogSchema.index({ action: 1 });

export const AuditLog = mongoose.model("AuditLog", auditLogSchema);
