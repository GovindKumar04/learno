import mongoose from "mongoose";

// Per-user browsing signal used to personalise the home page (Recommended /
// "Because you viewed"). One document per user, keyed by the user id.
// recentViews / recentSearches are kept short — only the most recent entries
// matter, so writes trim each list to MAX_RECENT newest-first.
const MAX_RECENT = 20;

const recentViewSchema = new mongoose.Schema(
  {
    courseId: { type: mongoose.Schema.Types.ObjectId, ref: "Course", required: true },
    category: { type: String, default: "" },
    at: { type: Date, default: Date.now },
  },
  { _id: false },
);

const recentSearchSchema = new mongoose.Schema(
  {
    q: { type: String, required: true, trim: true },
    at: { type: Date, default: Date.now },
  },
  { _id: false },
);

const userActivitySchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, unique: true }, // PG UUID
    recentViews: { type: [recentViewSchema], default: [] },
    recentSearches: { type: [recentSearchSchema], default: [] },
  },
  { timestamps: true },
);

userActivitySchema.statics.MAX_RECENT = MAX_RECENT;

export const UserActivity = mongoose.model("UserActivity", userActivitySchema);
