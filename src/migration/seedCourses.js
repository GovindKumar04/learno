import "dotenv/config";

import pool from "../config/db.js";
import connectMongoDB from "../config/mongodb.js";
import mongoose from "mongoose";
import { Course } from "../models/course.model.js";
import { Module } from "../models/module.model.js";

// ── Courses ──────────────────────────────────────────────────────────────────
// createdBy is filled in at runtime with a real admin UUID from PostgreSQL.
// Mapping from source data → schema:
//   Key Skills → learnPoints | Features → benefits | students → totalStudentsEnrolled
//   rating → averageRating | level "Professional" → "advanced" (enum constraint)
const COURSES = [
  {
    title: "Full Stack Web Development Professional",
    slug: "full-stack-web-development-professional",
    description: "Master modern web development with React, Node.js, and cloud deployment.",
    category: "Full Stack Development",
    level: "advanced", // Professional
    price: 15000,
    duration: "3 months",
    isPublished: true,
    averageRating: 4.9,
    totalStudentsEnrolled: 25,
    learnPoints: ["React", "Node.js", "Express", "MongoDB", "AWS"],
    benefits: [
      "Live project development",
      "Industry mentor guidance",
      "Portfolio creation",
      "Job placement assistance",
    ],
  },
  {
    title: "Data Science & Analytics Expert",
    slug: "data-science-analytics-expert",
    description: "Become a data science expert with Python, ML, and big data technologies.",
    category: "Data Science",
    level: "advanced", // Advanced
    price: 10000,
    duration: "8 months",
    isPublished: true,
    averageRating: 4.8,
    totalStudentsEnrolled: 30,
    learnPoints: ["Python", "Machine Learning", "SQL", "Tableau", "Apache Spark"],
    benefits: [
      "Real-world datasets",
      "ML model deployment",
      "Industry case studies",
      "Research project",
    ],
  },
  {
    title: "AWS Cloud Solutions Architect",
    slug: "aws-cloud-solutions-architect",
    description: "Design and deploy scalable cloud solutions on Amazon Web Services.",
    category: "Cloud & DevOps",
    level: "advanced", // Professional
    price: 0,
    duration: "4 months",
    isPublished: false, // no price yet — can't be published until one is assigned
    averageRating: 4.9,
    totalStudentsEnrolled: 3200,
    learnPoints: ["AWS", "Terraform", "Kubernetes", "Docker", "DevOps"],
    benefits: [
      "AWS hands-on labs",
      "Real cloud projects",
      "Cost optimization strategies",
      "Security best practices",
    ],
  },
  {
    title: "AI & Machine Learning Specialist",
    slug: "ai-machine-learning-specialist",
    description: "Master artificial intelligence and machine learning technologies.",
    category: "AI & Machine Learning",
    level: "advanced", // Advanced
    price: 0,
    duration: "10 months",
    isPublished: false, // no price yet — can't be published until one is assigned
    averageRating: 4.9,
    totalStudentsEnrolled: 1200,
    learnPoints: ["TensorFlow", "PyTorch", "Computer Vision", "NLP", "MLOps"],
    benefits: [
      "AI model development",
      "Research paper implementation",
      "Industry collaboration",
      "Patent filing guidance",
    ],
  },
  {
    title: "Mobile App Development Expert",
    slug: "mobile-app-development-expert",
    description: "Build native and cross-platform mobile applications.",
    category: "Mobile App Development",
    level: "intermediate", // Intermediate
    price: 14999,
    duration: "5 months",
    isPublished: true,
    averageRating: 4.7,
    totalStudentsEnrolled: 2100,
    learnPoints: ["React Native", "Flutter", "iOS", "Android", "Firebase"],
    benefits: [
      "Cross-platform development",
      "App store deployment",
      "Performance optimization",
      "User experience design",
    ],
  },
  {
    title: "Cybersecurity Professional",
    slug: "cybersecurity-professional",
    description: "Protect organizations from cyber threats and security vulnerabilities.",
    category: "Cybersecurity",
    level: "advanced", // Professional
    price: 0,
    duration: "6 months",
    isPublished: false, // no price yet — can't be published until one is assigned
    averageRating: 4.8,
    totalStudentsEnrolled: 1500,
    learnPoints: ["Ethical Hacking", "Network Security", "CISSP", "Penetration Testing", "Incident Response"],
    benefits: [
      "Hands-on security labs",
      "Real threat simulation",
      "Industry certifications",
      "Security audit projects",
    ],
  },

  // ── New courses (curriculum provided) ──────────────────────────────────────
  {
    title: "UI/UX Design Mastery",
    slug: "ui-ux-design-mastery",
    description: "Design intuitive, beautiful digital products — from user research to high-fidelity prototypes and a job-ready portfolio.",
    category: "UI/UX Design",
    level: "beginner",
    price: 12000,
    duration: "4 months",
    isPublished: true,
    averageRating: 4.8,
    totalStudentsEnrolled: 0,
    learnPoints: ["Figma", "Wireframing", "Prototyping", "Design Systems", "Usability Testing"],
    benefits: [
      "Portfolio reviews",
      "Live design projects",
      "Industry mentor guidance",
      "Case study development",
    ],
  },
  {
    title: "Digital Marketing Mastery",
    slug: "digital-marketing-mastery",
    description: "Master SEO, paid ads, social media, and analytics to run high-ROI marketing campaigns.",
    category: "Digital Marketing",
    level: "beginner",
    price: 12000,
    duration: "5 months",
    isPublished: true,
    averageRating: 4.7,
    totalStudentsEnrolled: 0,
    learnPoints: ["SEO", "Google Ads", "Meta Ads", "Content Strategy", "Analytics"],
    benefits: [
      "Live ad campaigns",
      "Industry tools access",
      "Freelancing guidance",
      "Certification prep",
    ],
  },
  {
    title: "Business Analyst Program",
    slug: "business-analyst-program",
    description: "Become a data-driven business analyst with Excel, SQL, Power BI, and analytics frameworks.",
    category: "Business Analytics",
    level: "intermediate",
    price: 13000,
    duration: "6 months",
    isPublished: true,
    averageRating: 4.8,
    totalStudentsEnrolled: 0,
    learnPoints: ["Excel", "SQL", "Power BI", "KPI Analysis", "Data Visualization"],
    benefits: [
      "Real analytics projects",
      "Capstone portfolio",
      "Industry case studies",
      "Interview preparation",
    ],
  },
  {
    title: "Backend Development",
    slug: "backend-development",
    description: "Build secure, scalable server-side applications and REST APIs with Node.js and Laravel, then deploy them to production.",
    category: "Backend Development",
    level: "intermediate",
    price: 12000,
    duration: "4 months",
    isPublished: true,
    averageRating: 4.8,
    totalStudentsEnrolled: 0,
    learnPoints: ["Node.js", "Express", "Laravel", "REST APIs", "Cloud Deployment"],
    benefits: [
      "Live API projects",
      "Authentication systems",
      "Cloud deployment",
      "Postman API testing",
    ],
  },
];

// ── Curricula (modules), keyed by course slug ────────────────────────────────
// Each module's `learn` (the "What you'll learn" line) is folded into the
// module description since the Module schema has no separate field for it.
const CURRICULA = {
  "ui-ux-design-mastery": [
    {
      title: "Module 1 — UI/UX Foundations",
      description: "Understand the core principles of UX and UI, user psychology, and how design solves problems.",
    },
    {
      title: "Module 2 — Wireframing & User Flow",
      description: "Structure information and create intuitive user journeys.",
    },
    {
      title: "Module 3 — Visual Design",
      description: "Learn color, typography, UI patterns, spacing and design systems.",
      learn: "Create polished UI screens using visual hierarchy and scalable UI systems.",
      topics: ["Color Theory", "Typography", "Design Systems", "Spacing & Grids", "Figma Components", "UI Patterns"],
      skills: ["Visual Design", "Typography", "Design Systems"],
    },
    {
      title: "Module 4 — Prototyping & Testing",
      description: "Build interactive prototypes and validate with real users.",
      learn: "Create clickable prototypes, micro-interactions, and conduct usability testing.",
      topics: ["Interactive Prototypes", "Smart Animate", "Micro-interactions", "Usability Testing", "A/B Testing", "Feedback Loops"],
      skills: ["Prototyping", "User Testing", "Interaction Design", "Animation"],
      project: "Mobile App Prototype",
    },
    {
      title: "Module 5 — Projects & Portfolio",
      description: "Build real-world case studies that make you job-ready.",
      learn: "Complete 3 polished case studies and build your UI/UX portfolio.",
      topics: ["E-commerce App UX", "Dashboard Design", "Food Delivery App", "Case Study Writing", "Portfolio Presentation"],
      skills: ["Case Studies", "Portfolio Building", "Storytelling", "Problem-solving"],
      project: "E-commerce Case Study, Dashboard UI Case Study",
    },
  ],

  "full-stack-web-development-professional": [
    {
      title: "Module 1 — Web Basics",
      description: "Learn the fundamentals of how the internet works and build your first web pages.",
      learn: "You will understand client-server architecture and build static websites.",
      topics: ["Internet & Web Architecture", "HTML, CSS, JS Fundamentals", "Client vs Server", "Responsive Design", "Developer Tools"],
      skills: ["HTML/CSS", "Responsive Pages", "Basic JavaScript"],
    },
    {
      title: "Module 2 — Advanced JavaScript",
      description: "Deep dive into modern JavaScript and problem-solving essentials.",
      learn: "You will be able to work with APIs, DOM, ES6+, and asynchronous JS.",
      topics: ["ES6+ Concepts", "Async/Await", "Callbacks & Promises", "DOM Manipulation", "Data Structures", "API Handling"],
      skills: ["Advanced JS", "API Workflows", "Problem Solving"],
    },
    {
      title: "Module 3 — React Development",
      description: "Learn React — the most in-demand frontend library.",
      learn: "You will build reusable components and dynamic applications.",
      topics: ["React Components", "Props & State", "React Router", "Custom Hooks", "Context API", "API Integration with Axios", "Tailwind + UI Libraries"],
      skills: ["React.js", "State Management", "Reusable UI"],
    },
    {
      title: "Module 4 — Backend Development with Node.js",
      description: "Learn server-side programming and build secure REST APIs.",
      learn: "You will be able to build complete backend systems using Node + Express.",
      topics: ["Node.js Basics", "Express.js Routing", "CRUD Operations", "JWT Authentication", "Middleware", "MongoDB + Mongoose", "Security Best Practices"],
      skills: ["API Development", "DB Modeling", "Auth Systems"],
    },
    {
      title: "Module 5 — Deployment & DevOps Basics",
      description: "Learn essential developer tools and deploy your apps.",
      learn: "You will deploy both frontend and backend servers live.",
      topics: ["Git & GitHub", "Frontend Deployment", "Backend Deployment", "Environment Variables", "CI/CD Basics", "Cloud Hosting (Vercel, Render)"],
      skills: ["Git Workflow", "Cloud Deployment", "Version Control"],
    },
  ],

  "digital-marketing-mastery": [
    {
      title: "Module 1 — Digital Marketing Fundamentals",
      description: "Understand how digital marketing works in real businesses.",
      learn: "You will gain a complete picture of digital channels, funnels & user behavior.",
      topics: ["Intro to Digital Marketing", "Marketing Funnels", "Paid vs Organic Strategies", "Customer Psychology"],
      skills: ["Marketing Strategy", "Consumer Behavior"],
    },
    {
      title: "Module 2 — SEO (Search Engine Optimization)",
      description: "Become an SEO expert by learning modern ranking strategies.",
      learn: "You will optimize websites to rank on Google search results.",
      topics: ["Keyword Research", "On-Page Optimization", "Technical SEO", "Backlink Building", "Search Console Tracking"],
      skills: ["SEO Tools", "Keyword Analysis", "Backlink Strategy"],
    },
    {
      title: "Module 3 — Google Ads (Performance Marketing)",
      description: "Run profitable ad campaigns using Google Ads.",
      learn: "You will create high-ROI search and display campaigns.",
      topics: ["Google Ads Dashboard", "Search Campaigns", "Display & Video Ads", "Keyword Bidding Strategies", "Performance Optimization"],
      skills: ["PPC Advertising", "Campaign Optimization"],
    },
    {
      title: "Module 4 — Meta Ads (Facebook & Instagram)",
      description: "Learn how to run paid campaigns for social platforms.",
      learn: "You will build creatives, audiences & conversion setups.",
      topics: ["Ad Manager Setup", "Audience Targeting", "Creative Strategy", "Retargeting Ads", "Analytics & Reporting"],
      skills: ["Paid Social", "Audience Research"],
    },
    {
      title: "Module 5 — Social Media & Content Branding",
      description: "Master content creation for Instagram, LinkedIn & YouTube.",
      learn: "You will create content that grows followers & brand visibility.",
      topics: ["Content Strategy", "Hashtags & Trends", "Brand Personality", "Reels & Short Video Strategy"],
      skills: ["Branding", "Content Strategy"],
    },
    {
      title: "Module 6 — Analytics, Reporting & Freelancing",
      description: "Understand analytics & build a professional portfolio.",
      learn: "You will become capable of measuring and presenting marketing performance.",
      topics: ["Google Analytics 4 (GA4)", "Tracking Setup", "Lead Reporting", "Building Client Proposals"],
      skills: ["Analytics", "Reporting"],
    },
  ],

  "cybersecurity-professional": [
    {
      title: "Module 1 — Cyber Security & Ethical Hacking Fundamentals",
      description: "Start your journey by understanding how hackers think and how systems get hacked.",
      learn: "You will understand attack lifecycle, cyber laws, fundamentals of hacking & security principles.",
      topics: ["Introduction to Cyber Security", "Types of Hackers", "Cyber Laws in India", "Footprinting & Reconnaissance", "Scanning Targets"],
      skills: ["Recon", "Scanning", "Threat Understanding"],
    },
    {
      title: "Module 2 — Network Security & Defense",
      description: "Learn how networks operate, how they get hacked, and how to defend them.",
      learn: "You will gain strong fundamentals in networking and secure architecture.",
      topics: ["TCP/IP Model", "Firewalls, IDS & IPS", "Proxy Servers", "Packet Analysis with Wireshark", "VPN & Secure Communications"],
      skills: ["Network Monitoring", "Packet Analysis"],
    },
    {
      title: "Module 3 — Kali Linux & Ethical Hacking Tools",
      description: "Master the most popular tools used by professional ethical hackers.",
      learn: "You will perform attacks using Kali Linux and automate tasks.",
      topics: ["Kali Linux Overview", "Nmap Scanning", "Hydra Brute Force", "Metasploit Framework", "Password Attacks"],
      skills: ["Kali Linux", "Metasploit", "Brute Force Attacks"],
    },
    {
      title: "Module 4 — Web Application Penetration Testing",
      description: "Learn how to hack websites and web apps ethically using OWASP standards.",
    },
    {
      title: "Module 5 — Incident Response, SOC & Bug Bounty",
      description: "Learn how companies detect, analyse and respond to cyber attacks.",
      learn: "You will be ready for SOC analyst & bug bounty roles.",
      topics: ["SOC Operations", "Incident Response Process", "Log Analysis", "SIEM Tools Overview", "Bug Bounty Platforms"],
      skills: ["Incident Response", "Log Analysis"],
    },
  ],

  "business-analyst-program": [
    {
      title: "Module 1 — Excel for Data Analysis",
      description: "Build a strong foundation in Excel — the #1 tool for analysts.",
      learn: "You will analyze datasets, create dashboards, and automate workflows.",
      topics: ["Advanced Excel Functions", "Pivot Tables & Pivot Charts", "Data Cleaning & Validation", "Business Dashboards"],
      skills: ["Data Cleaning", "Pivot Tables", "Excel Automation"],
    },
    {
      title: "Module 2 — SQL for Analysts",
      description: "Learn SQL to query, filter, sort, join, and analyze large datasets.",
      learn: "You will be able to write professional SQL queries used in companies.",
      topics: ["Basic to Advanced SQL Queries", "Joins, CTEs, Aggregations", "Window Functions", "Real Data Analysis with SQL"],
      skills: ["SQL Query Writing", "Database Analysis"],
    },
    {
      title: "Module 3 — Power BI & Data Visualization",
      description: "Create beautiful dashboards and interactive reports.",
      learn: "You will build BI reports that deliver insights for businesses.",
      topics: ["Power BI Interface", "Data Modeling", "DAX Measures", "Publishing & Sharing Dashboards"],
      skills: ["Data Visualization", "Report Building", "Data Modeling"],
    },
    {
      title: "Module 4 — Business & Marketing Analytics",
      description: "Understand KPIs, metrics & frameworks used by real companies.",
      learn: "You will be able to analyze growth, retention, and marketing data.",
      topics: ["Business Metrics & KPIs", "Marketing Funnel Analysis", "Customer Segmentation", "Cohort & Retention Analysis"],
      skills: ["KPI Analysis", "Segmentation", "Funnel Understanding"],
    },
    {
      title: "Module 5 — Capstone Projects + Portfolio",
      description: "Work on real analytics projects and build your portfolio.",
      learn: "Your portfolio will showcase your analytical skills to employers.",
      topics: ["E-commerce Analysis", "Financial Data Analysis", "Supply Chain Dashboard", "Case Study Preparation"],
      skills: ["Problem Solving", "Analytical Thinking"],
    },
  ],

  "backend-development": [
    {
      title: "Module 1 — Node.js Fundamentals",
      description: "Learn server-side JavaScript and the Node.js runtime.",
      learn: "You will understand the event loop, modules, and build command-line scripts.",
      topics: ["Node.js Runtime", "Event Loop", "Modules & npm", "File System", "Async Programming"],
      skills: ["Node.js", "Async JS", "npm"],
    },
    {
      title: "Module 2 — Express & REST APIs",
      description: "Build RESTful web servers with Express.js.",
      learn: "You will create routes, middleware, and structured REST APIs.",
      topics: ["Express Setup", "Routing", "Middleware", "REST Principles", "Error Handling"],
      skills: ["Express.js", "REST API Design", "Middleware"],
    },
    {
      title: "Module 3 — Databases with MongoDB & Mongoose",
      description: "Model and persist data using MongoDB and Mongoose.",
      learn: "You will design schemas and perform CRUD with relationships.",
      topics: ["MongoDB Basics", "Mongoose Schemas", "CRUD Operations", "Relationships & Population", "Indexes"],
      skills: ["MongoDB", "Data Modeling", "Mongoose"],
    },
    {
      title: "Module 4 — Authentication & Security",
      description: "Secure your APIs with authentication and best practices.",
      learn: "You will implement JWT auth, password hashing, and protect routes.",
      topics: ["JWT Authentication", "Password Hashing (bcrypt)", "Role-Based Access", "Input Validation", "Security Best Practices"],
      skills: ["Auth Systems", "Security", "Access Control"],
    },
    {
      title: "Module 5 — Deployment & Optimization",
      description: "Deploy backend apps to cloud platforms like a real developer.",
      learn: "You will deploy Node.js and Laravel apps to production servers.",
      topics: ["Git & GitHub Workflow", "Node Deployment (Render / Railway)", "Laravel Deployment (cPanel / VPS)", "Environment Secrets", "Postman API Testing"],
      skills: ["DevOps Basics", "API Testing", "Cloud Deployment"],
    },
  ],

  "data-science-analytics-expert": [
    {
      title: "Module 1 — Python for Data Science",
      description: "Build a strong Python foundation for data work.",
      learn: "You will manipulate data using Python and its core libraries.",
      topics: ["Python Basics", "NumPy", "pandas", "Jupyter Notebooks", "Data Structures"],
      skills: ["Python", "pandas", "NumPy"],
    },
    {
      title: "Module 2 — Data Wrangling & Visualization",
      description: "Clean, transform, and visualize real datasets.",
      learn: "You will prepare messy data and create insightful charts.",
      topics: ["Data Cleaning", "Feature Engineering", "Matplotlib", "Seaborn", "Exploratory Data Analysis"],
      skills: ["Data Cleaning", "Visualization", "EDA"],
    },
    {
      title: "Module 3 — Statistics & Probability",
      description: "Understand the math powering data science.",
      learn: "You will apply statistical tests and probability to data.",
      topics: ["Descriptive Statistics", "Probability Distributions", "Hypothesis Testing", "Correlation", "Regression Basics"],
      skills: ["Statistics", "Hypothesis Testing", "Probability"],
    },
    {
      title: "Module 4 — Machine Learning",
      description: "Build and evaluate predictive models.",
      learn: "You will train supervised and unsupervised models with scikit-learn.",
      topics: ["Supervised Learning", "Unsupervised Learning", "Model Evaluation", "scikit-learn", "Feature Selection"],
      skills: ["Machine Learning", "scikit-learn", "Model Evaluation"],
    },
    {
      title: "Module 5 — Big Data & Capstone",
      description: "Work with large-scale data and complete a capstone project.",
      learn: "You will process big data and present an end-to-end project.",
      topics: ["Apache Spark", "SQL for Analytics", "Data Pipelines", "Capstone Project", "Model Deployment"],
      skills: ["Apache Spark", "SQL", "Project Delivery"],
    },
  ],

  "aws-cloud-solutions-architect": [
    {
      title: "Module 1 — Cloud & AWS Fundamentals",
      description: "Understand cloud computing and core AWS services.",
      learn: "You will navigate the AWS console and core service categories.",
      topics: ["Cloud Concepts", "AWS Global Infrastructure", "IAM", "Billing & Pricing", "AWS CLI"],
      skills: ["AWS Fundamentals", "IAM", "Cloud Concepts"],
    },
    {
      title: "Module 2 — Compute & Networking",
      description: "Deploy compute resources and design secure networks.",
      learn: "You will launch EC2 instances and configure VPCs.",
      topics: ["EC2", "Auto Scaling", "Load Balancing", "VPC", "Security Groups"],
      skills: ["EC2", "VPC", "Networking"],
    },
    {
      title: "Module 3 — Storage & Databases",
      description: "Use AWS storage and managed database services.",
      learn: "You will store data with S3 and run managed databases.",
      topics: ["S3", "EBS", "RDS", "DynamoDB", "Backup & Recovery"],
      skills: ["S3", "RDS", "DynamoDB"],
    },
    {
      title: "Module 4 — Infrastructure as Code & DevOps",
      description: "Automate infrastructure and deployments.",
      learn: "You will provision infrastructure with Terraform and set up CI/CD.",
      topics: ["Terraform", "CloudFormation", "CI/CD Pipelines", "Docker on AWS", "Monitoring (CloudWatch)"],
      skills: ["Terraform", "CI/CD", "Docker"],
    },
    {
      title: "Module 5 — Architecture & Security Best Practices",
      description: "Design scalable, secure, cost-optimized architectures.",
      learn: "You will apply the Well-Architected Framework to real solutions.",
      topics: ["Well-Architected Framework", "High Availability", "Cost Optimization", "Security Best Practices", "Capstone Architecture"],
      skills: ["Solution Architecture", "Cost Optimization", "Security"],
    },
  ],

  "ai-machine-learning-specialist": [
    {
      title: "Module 1 — Math & Python for AI",
      description: "Build the math and coding foundation for AI.",
      learn: "You will apply linear algebra and Python to ML problems.",
      topics: ["Linear Algebra", "Calculus for ML", "Probability", "NumPy", "pandas"],
      skills: ["Python", "Linear Algebra", "Math for ML"],
    },
    {
      title: "Module 2 — Machine Learning Foundations",
      description: "Learn classical machine learning algorithms.",
      learn: "You will train and evaluate ML models with scikit-learn.",
      topics: ["Regression", "Classification", "Clustering", "Model Evaluation", "scikit-learn"],
      skills: ["Machine Learning", "scikit-learn", "Model Evaluation"],
    },
    {
      title: "Module 3 — Deep Learning",
      description: "Build neural networks with modern frameworks.",
      learn: "You will design and train deep neural networks.",
      topics: ["Neural Networks", "Backpropagation", "TensorFlow", "PyTorch", "CNNs"],
      skills: ["Deep Learning", "TensorFlow", "PyTorch"],
    },
    {
      title: "Module 4 — Computer Vision & NLP",
      description: "Apply deep learning to images and language.",
      learn: "You will build computer vision and natural language models.",
      topics: ["Image Classification", "Object Detection", "Text Processing", "Transformers", "Transfer Learning"],
      skills: ["Computer Vision", "NLP", "Transformers"],
    },
    {
      title: "Module 5 — MLOps & Capstone",
      description: "Deploy and operate ML models in production.",
      learn: "You will build an end-to-end ML pipeline and deploy a model.",
      topics: ["Model Deployment", "MLOps Pipelines", "Model Monitoring", "Docker & APIs", "Capstone Project"],
      skills: ["MLOps", "Model Deployment", "Project Delivery"],
    },
  ],

  "mobile-app-development-expert": [
    {
      title: "Module 1 — Mobile Development Foundations",
      description: "Understand mobile platforms and development setup.",
      learn: "You will set up your environment and build your first app.",
      topics: ["Mobile Platforms", "Dev Environment Setup", "JavaScript/Dart Basics", "App Anatomy", "Emulators"],
      skills: ["Environment Setup", "Mobile Basics"],
    },
    {
      title: "Module 2 — React Native Core",
      description: "Build cross-platform apps with React Native.",
      learn: "You will create UIs with components, styling, and navigation.",
      topics: ["Components & Props", "State & Hooks", "Styling & Flexbox", "Lists & ScrollViews", "Navigation"],
      skills: ["React Native", "UI Building", "Navigation"],
    },
    {
      title: "Module 3 — State Management & APIs",
      description: "Manage app state and connect to backends.",
      learn: "You will integrate REST APIs and manage global state.",
      topics: ["Context API", "Redux Toolkit", "REST API Integration", "Async Storage", "Forms & Validation"],
      skills: ["State Management", "API Integration"],
    },
    {
      title: "Module 4 — Native Features & Firebase",
      description: "Use device features and a real-time backend.",
      learn: "You will access native modules and integrate Firebase.",
      topics: ["Camera & Location", "Push Notifications", "Firebase Auth", "Firestore", "Native Modules"],
      skills: ["Firebase", "Native Integrations", "Push Notifications"],
    },
    {
      title: "Module 5 — Testing, Optimization & Deployment",
      description: "Polish, test, and publish your app to the stores.",
      learn: "You will optimize performance and publish to app stores.",
      topics: ["Performance Optimization", "Debugging", "Testing", "App Store Deployment", "Play Store Deployment"],
      skills: ["App Store Deployment", "Performance", "Testing"],
    },
  ],
};

async function getAdminUserId() {
  // createdBy on a course must be a real PostgreSQL admin UUID.
  try {
    const { rows } = await pool.query(
      "SELECT id FROM users WHERE role = 'admin' ORDER BY created_at ASC LIMIT 1",
    );
    if (rows.length) return rows[0].id;
  } catch (err) {
    console.warn("⚠️  Could not read admin from PostgreSQL:", err.message);
  }
  return null;
}

// Rebuild the modules for a seeded course (delete + recreate so re-running is idempotent).
async function seedModules(course) {
  const mods = CURRICULA[course.slug];
  if (!mods) return 0;

  await Module.deleteMany({ course: course._id });

  const ids = [];
  for (let i = 0; i < mods.length; i++) {
    const m = mods[i];
    const description = m.learn ? `${m.description} ${m.learn}` : m.description;
    const doc = await Module.create({
      title: m.title,
      description,
      course: course._id,
      order: i + 1,
      topics: m.topics || [],
      skills: m.skills || [],
      project: m.project || "",
    });
    ids.push(doc._id);
  }

  course.modules = ids;
  await course.save();
  return ids.length;
}

async function seedCourses() {
  console.log("⏳ Connecting to databases...");
  await connectMongoDB();

  const adminId = await getAdminUserId();
  if (!adminId) {
    console.error("❌ No admin user found in PostgreSQL. Create an admin first, then re-run.");
    await mongoose.connection.close();
    await pool.end();
    process.exit(1);
  }
  console.log(`✅ Using admin ${adminId} as course creator`);

  let created = 0;
  let updated = 0;
  let totalModules = 0;

  for (const data of COURSES) {
    const doc = { ...data, createdBy: adminId };
    // Mirror the single price into both delivery modes so the admin editor
    // and student PaymentModal both have consistent online/offline pricing.
    if (doc.priceOnline === undefined)  doc.priceOnline  = doc.price || 0;
    if (doc.priceOffline === undefined) doc.priceOffline = doc.price || 0;
    // Upsert by slug so re-running the seeder doesn't create duplicates.
    let course = await Course.findOne({ slug: doc.slug });
    if (course) {
      course.set(doc);
      await course.save();
      updated += 1;
      console.log(`   ↻ updated: ${doc.title}`);
    } else {
      course = await Course.create(doc);
      created += 1;
      console.log(`   + created: ${doc.title}`);
    }

    const n = await seedModules(course);
    if (n) {
      totalModules += n;
      console.log(`       ↳ ${n} modules`);
    }
  }

  console.log(`\n✅ Seed complete — ${created} created, ${updated} updated, ${totalModules} modules.`);

  await mongoose.connection.close();
  await pool.end();
  process.exit(0);
}

seedCourses().catch(async (err) => {
  console.error("❌ Seeding failed:", err);
  try { await mongoose.connection.close(); } catch { /* ignore */ }
  try { await pool.end(); } catch { /* ignore */ }
  process.exit(1);
});
