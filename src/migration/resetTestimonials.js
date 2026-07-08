// One-off: wipe ALL existing testimonials, then seed fresh ones built from real
// Fillip trainees. Mirrors deleteTestimonialService — cleans up each doc's
// Cloudinary avatar and invalidates the public list cache.
//
// Run:  cd backend && node src/migration/resetTestimonials.js

import "dotenv/config";
import connectMongoDB from "../config/mongodb.js";
import { Testimonial } from "../models/testimonial.model.js";
import { deleteFromCloudinary } from "../utils/cloudinary.util.js";
import { bumpNs } from "../utils/cache.js";

// New flashy testimonials drawn from real trainees (global = homepage).
const ITEMS = [
  {
    name: "Ashish Raj",
    role: "Full Stack Developer (Fillip Graduate)",
    quote:
      "Fillip turned me from a curious beginner into a confident full-stack developer. The live projects, the mentorship, the late-night doubt sessions — every bit was worth it. Easily the best decision of my career! 🚀",
    rating: 5,
    order: 1,
  },
  {
    name: "Suyash Choudhary",
    role: "Full Stack Developer (Fillip Graduate)",
    quote:
      "Three months at Fillip and I was building complete MERN apps from scratch. The hands-on approach is unreal — you don't just learn to code, you learn to ship real products.",
    rating: 5,
    order: 2,
  },
  {
    name: "Avnish Chandra",
    role: "Digital Marketing Specialist (Fillip Graduate)",
    quote:
      "In one intensive week, Fillip's Digital Marketing program gave me skills I now use every single day. Practical, fast-paced, and packed with real campaigns. Absolutely loved it!",
    rating: 5,
    order: 3,
  },
  {
    name: "Shiv Nandan",
    role: "Digital Marketing Professional (Fillip Graduate)",
    quote:
      "Fillip's Digital Marketing course is a game-changer. From SEO to paid ads, I learned to run real campaigns that actually convert. The mentors genuinely care about your growth.",
    rating: 5,
    order: 4,
  },
  {
    name: "Mohit",
    role: "Software Engineer | DSA Trained at Fillip",
    quote:
      "The DSA training at Fillip cracked the code for me — literally. 45 days of intense problem-solving and now I walk into coding interviews with total confidence.",
    rating: 5,
    order: 5,
  },
  {
    name: "Farha Malick",
    role: "HR Professional (Fillip Intern)",
    quote:
      "My HR internship at Fillip was hands-on from day one — real responsibilities, real people, real growth. I stepped out job-ready with skills no classroom could teach.",
    rating: 5,
    order: 6,
  },
  {
    name: "Anmol Kumari",
    role: "HR Professional (Fillip Intern)",
    quote:
      "Fillip's HR internship was the perfect launchpad. The exposure to real recruitment and people management made me industry-ready in just 45 days.",
    rating: 5,
    order: 7,
  },
  {
    name: "Sudhanshu Pandey",
    role: "Graphic Designer (Fillip Graduate)",
    quote:
      "Fillip's Graphic Designing program unlocked my creativity and gave it direction. Two months of real design projects and I built a portfolio I'm genuinely proud of.",
    rating: 5,
    order: 8,
  },
  {
    name: "Yuvraj",
    role: "Full Stack Developer (Fillip Graduate)",
    quote:
      "Fillip doesn't just teach you tech — it builds your mindset. The 3-month full-stack journey was intense, fun, and completely transformed how I solve problems.",
    rating: 5,
    order: 9,
  },
  {
    name: "Govind Kumar",
    role: "Full Stack Developer (Fillip Graduate)",
    quote:
      "From zero to deploying full-stack apps — Fillip made it happen. The mentors push you, believe in you, and celebrate every win with you. Forever grateful!",
    rating: 5,
    order: 10,
  },
];

async function run() {
  try {
    await connectMongoDB();

    // 1) Wipe existing testimonials (+ their Cloudinary avatars).
    const existing = await Testimonial.find({}, "name avatarPublicId").lean();
    console.log(`Found ${existing.length} existing testimonial(s) to delete.`);
    for (const t of existing) {
      if (t.avatarPublicId) {
        try {
          await deleteFromCloudinary(t.avatarPublicId, "image");
          console.log(`  • removed avatar for "${t.name}"`);
        } catch (e) {
          console.warn(`  • avatar cleanup failed for "${t.name}": ${e.message}`);
        }
      }
    }
    const del = await Testimonial.deleteMany({});
    console.log(`Deleted ${del.deletedCount} testimonial(s).`);

    // 2) Seed the fresh set.
    const created = await Testimonial.insertMany(
      ITEMS.map((i) => ({ ...i, courseId: null, isPublished: true }))
    );
    console.log(`Inserted ${created.length} new testimonial(s).`);

    // 3) Invalidate the public list cache.
    await bumpNs("testimonials");
    console.log("✅ Done. Testimonials reset.");
    process.exit(0);
  } catch (error) {
    console.error("resetTestimonials failed:");
    console.error(error);
    process.exit(1);
  }
}

run();
