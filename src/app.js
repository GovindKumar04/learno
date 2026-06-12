import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import compression from "compression";
import { apiLimiter } from "./middlewares/rateLimit.middleware.js";
import { authrouter } from "./routes/auth.routes.js";
import { courseRouter } from "./routes/course.routes.js";
import { contactRouter } from "./routes/contact.routes.js";
import { enquiryRouter } from "./routes/enquiry.routes.js";
import { progressRouter } from "./routes/progress.routes.js";
import { enrollmentRouter } from "./routes/enrollment.routes.js";
import { paymentRouter } from "./routes/payment.routes.js";
import { siteConfigRouter } from "./routes/siteConfig.routes.js";
import { scholarshipRouter } from "./routes/scholarship.routes.js";
import { affiliateRouter } from "./routes/affiliate.routes.js";
import { teachingRequestRouter } from "./routes/teachingRequest.routes.js";
import { batchRouter } from "./routes/batch.routes.js";
import { attendanceRouter } from "./routes/attendance.routes.js";
import { certificateRouter } from "./routes/certificate.routes.js";
import { mailRouter } from "./routes/mail.routes.js";
import { chatRouter } from "./routes/chat.routes.js";
import { getSitemap } from "./controllers/sitemap.controller.js";

const app = express();

// Behind Nginx in production — trust exactly one proxy hop so req.ip is the real
// client (needed for rate limiting and audit logging), without trusting
// arbitrary X-Forwarded-For values.
app.set("trust proxy", 1);

// Security headers. CORP is relaxed to cross-origin because the API serves
// images/PDFs (avatars, certificates) that the client loads from another origin.
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));

// Gzip responses — free latency/bandwidth win.
app.use(compression());

// Cap request bodies so a single oversized payload can't pin a worker.
app.use(express.json({ limit: "100kb" }));
app.use(cors({
  origin: process.env.NODE_ENV === "production"
    ? process.env.CLIENT_URL  // set CLIENT_URL in .env for production
    : ["http://localhost:5173", "http://localhost:5174"],
  credentials: true,
}));
app.use(cookieParser());

// General flood protection on every route (targeted limiters live on the
// sensitive routers below).
app.use(apiLimiter);

// Dynamic sitemap — built from published courses + static routes.
// In production Nginx proxies /sitemap.xml here (see deploy/nginx.conf).
app.get("/sitemap.xml", getSitemap);

app.use("/auth", authrouter);
app.use("/courses", courseRouter);
app.use("/contact", contactRouter);
app.use("/enquiries", enquiryRouter);
app.use("/progress", progressRouter);
app.use("/enrollments", enrollmentRouter);
app.use("/payments", paymentRouter);
app.use("/site-config", siteConfigRouter);
app.use("/scholarships", scholarshipRouter);
app.use("/affiliates", affiliateRouter);
app.use("/teaching-requests", teachingRequestRouter);
app.use("/batches", batchRouter);
app.use("/attendance", attendanceRouter);
app.use("/certificates", certificateRouter);
app.use("/mail", mailRouter);
app.use("/chat", chatRouter);

// GLOBAL ERROR HANDLER — must be last
app.use((err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  const message = err.message || "Internal Server Error";

  return res.status(statusCode).json({
    success: false,
    statusCode,
    message,
    errors: err.errors || [],
    ...(process.env.NODE_ENV !== "production" && { stack: err.stack }),
  });
});

export { app };