import mongoose from "mongoose";
import { newId } from "../utils/id.util.js";

// Migrated from the Postgres `commissions` table. sale_amount / commission_amount
// are stored in paise (integer), matching the prior schema.
const commissionSchema = new mongoose.Schema(
  {
    _id:               { type: String, default: newId },
    affiliate_user_id: { type: String, required: true },
    referred_user_id:  { type: String, required: true },
    payment_id:        { type: String, required: true },
    course_title:      { type: String, required: true },
    sale_amount:       { type: Number, required: true },
    commission_amount: { type: Number, required: true },
    status:            { type: String, default: "pending" }, // 'pending' | 'approved' | 'paid'
    paid_at:           { type: Date },
  },
  {
    // SQL had only created_at (no updated_at) on this table.
    timestamps: { createdAt: "created_at", updatedAt: false },
    toJSON:   { virtuals: true, transform: (_, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: true },
  }
);

commissionSchema.index({ affiliate_user_id: 1 });
commissionSchema.index({ referred_user_id: 1 });

export const Commission = mongoose.model("Commission", commissionSchema);
