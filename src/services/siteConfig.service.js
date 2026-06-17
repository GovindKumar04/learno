import { SiteConfig } from "../models/siteConfig.model.js";
import { getOrSet, cacheDel } from "../utils/cache.js";

const SITE_CONFIG_KEY = "site-config";

export const DEFAULT_CONFIG = {
  milestones: [
    { value: "500+",  label: "Students Trained",   icon: "👨‍🎓", order: 0 },
    { value: "50+",   label: "Expert Mentors",      icon: "👨‍🏫", order: 1 },
    { value: "20+",   label: "Courses Available",   icon: "📚",  order: 2 },
    { value: "95%",   label: "Placement Rate",      icon: "🎯",  order: 3 },
    { value: "5+",    label: "Years of Excellence", icon: "🏆",  order: 4 },
    { value: "100%",  label: "Practical Training",  icon: "⚡",  order: 5 },
  ],
  whyChooseUs: [
    { title: "Industry Expert Mentors",    description: "Learn directly from professionals with years of industry experience and real-world project knowledge.", icon: "👨‍💼", order: 0 },
    { title: "Hands-On Live Projects",     description: "Work on real projects during training so you graduate with a portfolio that impresses employers.",       icon: "💻",  order: 1 },
    { title: "Job-Placement Support",      description: "We actively help students with resume building, mock interviews, and connecting with hiring partners.",   icon: "🎯",  order: 2 },
    { title: "Flexible Online & Offline",  description: "Choose the mode that works for you — attend live online sessions or join our in-person classroom batches.", icon: "🌐", order: 3 },
    { title: "Affordable Fee Structure",   description: "Quality education shouldn't break the bank. Our courses are priced to be accessible for every aspiring learner.", icon: "💰", order: 4 },
    { title: "Certificate of Completion", description: "Earn a recognised certificate on course completion to boost your professional credibility and LinkedIn profile.", icon: "🏅", order: 5 },
  ],
  faqs: [
    { question: "What courses do you offer?",              answer: "We offer job-oriented courses in Full-Stack Development, UI/UX Design, Graphic Design, Digital Marketing, Cyber Security, AI & ML, Business Analytics, and more.",  order: 0 },
    { question: "Are courses suitable for beginners?",     answer: "Yes. We start from the basics and build up to advanced topics with practical projects and live mentorship.", order: 1 },
    { question: "Do you provide internship opportunities?", answer: "Yes. We offer internship programs where students work on real-time projects to gain practical industry experience.", order: 2 },
    { question: "Are classes online or offline?",          answer: "Both. You can attend live online sessions or join our in-person batches at our Patna centre.", order: 3 },
    { question: "Do you provide certificates?",            answer: "Yes. Students receive a verified certificate on successful course completion, recognized by industry partners.", order: 4 },
    { question: "What is the course duration?",            answer: "Duration varies by course — most programs range from 2 to 6 months. Check individual course pages for exact timelines.", order: 5 },
    { question: "Are there flexible payment options?",     answer: "Yes. We offer EMI and installment options. Contact our team for details.", order: 6 },
    { question: "Do you provide placement support?",       answer: "Yes. We assist with resume building, mock interviews, and connecting students with our hiring partners.", order: 7 },
  ],
  offers: [],
};

export const getSiteConfigService = async () => {
  // Public, hit on every homepage load, changes rarely → cache 1h.
  return getOrSet(SITE_CONFIG_KEY, 3600, async () => {
    const config = await SiteConfig.findOne();
    return config || DEFAULT_CONFIG;
  });
};

export const updateSiteConfigService = async ({ milestones, whyChooseUs, faqs, offers }) => {
  const update = {};
  if (milestones)  update.milestones  = milestones;
  if (whyChooseUs) update.whyChooseUs = whyChooseUs;
  if (faqs)        update.faqs        = faqs;
  if (offers)      update.offers      = offers;

  const saved = await SiteConfig.findOneAndUpdate({}, update, { new: true, upsert: true, runValidators: true });
  await cacheDel(SITE_CONFIG_KEY);
  return saved;
};
