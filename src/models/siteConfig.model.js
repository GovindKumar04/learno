import mongoose from "mongoose";

const milestoneSchema = new mongoose.Schema({
  value: { type: String, required: true },
  label: { type: String, required: true },
  icon:  { type: String, default: "🏆" },
  order: { type: Number, default: 0 },
}, { _id: false });

const whyChooseSchema = new mongoose.Schema({
  title:       { type: String, required: true },
  description: { type: String, required: true },
  icon:        { type: String, default: "✅" },
  order:       { type: Number, default: 0 },
});

const faqSchema = new mongoose.Schema({
  question: { type: String, required: true },
  answer:   { type: String, required: true },
  order:    { type: Number, default: 0 },
}, { _id: false });

// Promotional offers shown in the site-wide announcement bar above the header.
// `active` lets admins toggle an offer on/off without deleting it.
const offerSchema = new mongoose.Schema({
  text:   { type: String, required: true },
  link:   { type: String, default: "" },
  active: { type: Boolean, default: true },
  order:  { type: Number, default: 0 },
}, { _id: false });

// Website logo for the nav bar / footer. `zoom` is a display scale multiplier
// (1 = original size) so admins can fine-tune how large the uploaded logo appears
// without re-exporting the image. `publicId` is kept so the old Cloudinary asset
// can be deleted when a new logo is uploaded.
const logoSchema = new mongoose.Schema({
  url:      { type: String, default: "" },
  publicId: { type: String, default: "" },
  zoom:     { type: Number, default: 1, min: 0.2, max: 4 },
  // When true the logo is delivered with its solid background made transparent.
  removeBg: { type: Boolean, default: false },
}, { _id: false });

const siteConfigSchema = new mongoose.Schema({
  milestones:  [milestoneSchema],
  whyChooseUs: [whyChooseSchema],
  faqs:        [faqSchema],
  offers:      [offerSchema],
  logos: {
    navbar: { type: logoSchema, default: () => ({}) },
    footer: { type: logoSchema, default: () => ({}) },
  },
}, { timestamps: true });

export const SiteConfig = mongoose.model("SiteConfig", siteConfigSchema);
