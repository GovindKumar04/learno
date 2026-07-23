/**
 * Category audit (idempotent): reassign every course to a broad, content-based
 * category. The mapping was built by reading each course's MODULES, not by
 * trusting its old category label (several were plainly wrong — e.g. a Venture
 * Capital fundraising course must not sit under an AI bucket).
 *
 * 12 broad categories (down from ~70 fragmented/duplicate ones).
 *
 * Keyed by course TITLE. A few titles repeat across programs (e.g. three
 * "Digital Marketing Professional" durations); they all map to the same category,
 * so a title→category map is safe.
 *
 * Dry run:  SEED_DRY=true node src/scripts/recategorizeCourses.js
 * Apply:    node src/scripts/recategorizeCourses.js
 */
import "dotenv/config";
import mongoose from "mongoose";
import connectMongoDB from "../config/mongodb.js";
import { Course } from "../models/course.model.js";
import { bumpNs } from "../utils/cache.js";

// course title  →  broad category (decided from the course's actual modules)
const COURSE_CATEGORY = {
  // ── Artificial Intelligence & Data Science ──
  "AI Software Engineer Pro": "Artificial Intelligence & Data Science",
  "AI Tools for Business & Professionals": "Artificial Intelligence & Data Science",
  "AI for Entrepreneurs": "Artificial Intelligence & Data Science",
  "Artificial Intelligence Productivity Professional": "Artificial Intelligence & Data Science",
  "ChatGPT & AI Business Automation": "Artificial Intelligence & Data Science",
  "Computer Vision Engineer": "Artificial Intelligence & Data Science",
  "Deep Learning Specialist": "Artificial Intelligence & Data Science",
  "Natural Language Processing Professional": "Artificial Intelligence & Data Science",
  "Machine Learning Professional": "Artificial Intelligence & Data Science",
  "Generative AI & LLM Developer": "Artificial Intelligence & Data Science",
  "Data Science Master Program": "Artificial Intelligence & Data Science",
  "Data Engineering & Pipeline Development": "Artificial Intelligence & Data Science",
  "Business Analytics for Decision Making": "Artificial Intelligence & Data Science",
  "Power BI & Business Analytics Professional": "Artificial Intelligence & Data Science",
  "Power BI Business Intelligence Starter": "Artificial Intelligence & Data Science",
  "Power BI for Business Executives": "Artificial Intelligence & Data Science",
  "Professional Data Analytics Foundation": "Artificial Intelligence & Data Science",
  "Professional Excel & Data Analysis": "Artificial Intelligence & Data Science",

  // ── Web & Mobile Development ──
  "MEAN Stack Developer": "Web & Mobile Development",
  "MERN Stack Developer": "Web & Mobile Development",
  "Python Full Stack Developer": "Web & Mobile Development",
  "Web Design Professional": "Web & Mobile Development",
  "Website Development Starter": "Web & Mobile Development",
  "WordPress Website Development": "Web & Mobile Development",
  "WordPress Website Development Professional": "Web & Mobile Development",
  "Android Kotlin Professional": "Web & Mobile Development",
  "Flutter Mobile App Engineer": "Web & Mobile Development",
  "Mobile App Development Professional (Flutter Basics)": "Web & Mobile Development",
  "iOS Swift Developer": "Web & Mobile Development",

  // ── Software & Emerging Tech ──
  ".NET Enterprise Developer": "Software & Emerging Tech",
  "Java Enterprise Developer": "Software & Emerging Tech",
  "Spring Boot Java Professional": "Software & Emerging Tech",
  "SAP ABAP & S/4HANA Developer": "Software & Emerging Tech",
  "Salesforce Developer": "Software & Emerging Tech",
  "Blockchain & Web3 Developer": "Software & Emerging Tech",
  "AR/VR Developer": "Software & Emerging Tech",
  "Robotics & Automation Engineer": "Software & Emerging Tech",
  "Robotics & Embedded Systems Professional": "Software & Emerging Tech",
  "Python Programming Bootcamp": "Software & Emerging Tech",
  "Python Programming Professional": "Software & Emerging Tech",

  // ── Cloud & DevOps ──
  "AWS Cloud Engineer": "Cloud & DevOps",
  "Cloud Computing Professional": "Cloud & DevOps",
  "Google Cloud Professional": "Cloud & DevOps",
  "Microsoft Azure Administrator": "Cloud & DevOps",
  "DevOps Engineer Professional": "Cloud & DevOps",
  "Site Reliability Engineering": "Cloud & DevOps",

  // ── Cyber Security ──
  "Cloud Security Engineer": "Cyber Security",
  "Cyber Security Associate": "Cyber Security",
  "Cyber Security Foundation": "Cyber Security",
  "Cyber Security Professional": "Cyber Security",
  "Ethical Hacking & Penetration Testing": "Cyber Security",
  "Network Security & Firewall Administration": "Cyber Security",
  "SOC Analyst & Threat Intelligence": "Cyber Security",

  // ── Design & Multimedia ──
  "Branding & Corporate Identity Design": "Design & Multimedia",
  "Graphic Design & Branding Professional": "Design & Multimedia",
  "Graphic Design & Motion Graphics": "Design & Multimedia",
  "Graphic Design Professional": "Design & Multimedia",
  "UI/UX Design Professional": "Design & Multimedia",
  "Video Editing & Content Creation": "Design & Multimedia",
  "Video Editing & Motion Graphics Professional": "Design & Multimedia",
  "Video Editing & Production": "Design & Multimedia",

  // ── Digital Marketing ──
  "Digital Marketing Professional": "Digital Marketing",
  "Digital Marketing for Business Growth": "Digital Marketing",
  "Personal Branding for Entrepreneurs": "Digital Marketing",
  "Social Media Marketing & Content Strategy": "Digital Marketing",

  // ── Finance & Accounting ──
  "Professional Accountant with GST & Tally Prime": "Finance & Accounting",
  "Tally Prime with GST Professional": "Finance & Accounting",
  "GST, Taxation & Business Accounting": "Finance & Accounting",
  "Financial Planning for Entrepreneurs": "Finance & Accounting",
  "Startup Financial Modeling & Valuation": "Finance & Accounting",

  // ── Business & Management ──
  "Business Documentation & Corporate Communication": "Business & Management",
  "Business Process Automation": "Business & Management",
  "Business Registration & Legal Compliance": "Business & Management",
  "Company Formation & ROC Compliance": "Business & Management",
  "CEO Excellence & Executive Leadership Program": "Business & Management",
  "CRM & Customer Relationship Management": "Business & Management",
  "Franchise Business Development": "Business & Management",
  "Government Project Proposal & DPR Writing": "Business & Management",
  "Human Resource Management for MSMEs": "Business & Management",
  "IP & Technology Transfer": "Business & Management",
  "Inventory & Warehouse Management": "Business & Management",
  "Leadership & Team Management": "Business & Management",
  "Office Administration & SOP Development": "Business & Management",
  "Operations & Supply Chain for Startups": "Business & Management",
  "Payroll & Labour Law Compliance": "Business & Management",
  "Public Speaking & Executive Communication": "Business & Management",
  "Recruitment & Talent Acquisition": "Business & Management",
  "Sales & Business Development Mastery": "Business & Management",
  "Tender Management & Government e-Procurement": "Business & Management",

  // ── Entrepreneurship & Startup (incl. sector-specific business ventures) ──
  "Startup Launchpad Mastery Program": "Entrepreneurship & Startup",
  "Startup Incubation & Accelerator Program": "Entrepreneurship & Startup",
  "Business Model Canvas Professional": "Entrepreneurship & Startup",
  "Startup Pitch Deck & Investor Presentation": "Entrepreneurship & Startup",
  "Venture Capital & Angel Investment Readiness": "Entrepreneurship & Startup",
  "Investment Readiness & Fundraising": "Entrepreneurship & Startup",
  "Product Management for Non-Tech Founders": "Entrepreneurship & Startup",
  "Amazon, Flipkart & ONDC Seller Program": "Entrepreneurship & Startup",
  "E-Commerce Business Mastery": "Entrepreneurship & Startup",
  "Agricultural Business & Agri-Tech Entrepreneurship": "Entrepreneurship & Startup",
  "Educational Institution & EdTech Startup": "Entrepreneurship & Startup",
  "Environmental & Sustainability Business": "Entrepreneurship & Startup",
  "Export Business & International Trade": "Entrepreneurship & Startup",
  "Fashion & Lifestyle Brand Building": "Entrepreneurship & Startup",
  "Healthcare & Wellness Business": "Entrepreneurship & Startup",
  "Real Estate Business Management": "Entrepreneurship & Startup",
  "Sports & Fitness Business": "Entrepreneurship & Startup",
  "Tourism & Hospitality Business": "Entrepreneurship & Startup",

  // ── Computer & Office Basics ──
  "Advanced Microsoft Office Professional": "Computer & Office Basics",
  "Professional Office Executive (POE)": "Computer & Office Basics",
  "Computer Foundation Professional (CFP)": "Computer & Office Basics",
  "Computer Hardware & Networking Essentials": "Computer & Office Basics",
  "Computer Hardware & Networking Professional": "Computer & Office Basics",

  // ── Career Development ──
  "Professional Employability & Career Success Program": "Career Development",
  "LinkedIn & Professional Networking": "Career Development",
};

const DRY = process.env.SEED_DRY === "true";

async function run() {
  await connectMongoDB();

  const courses = await Course.find({}).select("title category").lean();
  console.log(`Loaded ${courses.length} courses.`);

  // Any title missing from the map is a safety stop — don't silently leave a
  // course behind in a stale bucket.
  const unmapped = courses.filter((c) => !(c.title in COURSE_CATEGORY));
  if (unmapped.length) {
    console.error("❌ These course titles have no mapping — add them and re-run:");
    unmapped.forEach((c) => console.error(`   - "${c.title}"  (currently "${c.category}")`));
    await mongoose.disconnect();
    process.exit(1);
  }

  const ops = [];
  const summary = new Map(); // target -> count
  let changed = 0;
  for (const c of courses) {
    const target = COURSE_CATEGORY[c.title];
    summary.set(target, (summary.get(target) || 0) + 1);
    if (target !== c.category) {
      changed++;
      if (DRY) console.log(`  ${c.title}\n      "${c.category}"  →  "${target}"`);
      ops.push({ updateOne: { filter: { _id: c._id }, update: { $set: { category: target } } } });
    }
  }

  console.log(`\nResulting ${summary.size} categories:`);
  [...summary.entries()].sort().forEach(([cat, n]) => console.log(`   ${String(n).padStart(3)}  ${cat}`));
  console.log(`\n${changed} of ${courses.length} courses will move category.`);

  if (DRY) {
    console.log("\n(dry run — no database changes)");
    await mongoose.disconnect();
    return;
  }

  if (ops.length) {
    const res = await Course.bulkWrite(ops);
    await bumpNs("courses"); // invalidate cached catalog list + categories
    console.log(`\n✅ Updated ${res.modifiedCount} courses. Catalog cache invalidated.`);
  } else {
    console.log("\n✅ Nothing to change — already consolidated.");
  }
  await mongoose.disconnect();
  process.exit(0);
}

run().catch(async (e) => {
  console.error("Recategorize failed:", e);
  try { await mongoose.disconnect(); } catch { /* ignore */ }
  process.exit(1);
});
