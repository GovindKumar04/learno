import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
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

const app = express();

app.use(express.json());
app.use(cors({
  origin: process.env.NODE_ENV === "production"
    ? process.env.CLIENT_URL  // set CLIENT_URL in .env for production
    : ["http://localhost:5173", "http://localhost:5174"],
  credentials: true,
}));
app.use(cookieParser());

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