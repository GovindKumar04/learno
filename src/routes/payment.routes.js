import express from "express";
import { createOrder, verifyPayment, getPaymentHistory, getMyPayments } from "../controllers/payment.controller.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";
import { requireRole } from "../middlewares/role.middleware.js";
import { sensitiveLimiter } from "../middlewares/rateLimit.middleware.js";

const paymentRouter = express.Router();

paymentRouter.use(verifyJWT);

// Student creates a Razorpay order
paymentRouter.post("/create-order", requireRole("student"), sensitiveLimiter, createOrder);

// Student verifies payment after Razorpay checkout
paymentRouter.post("/verify", requireRole("student"), sensitiveLimiter, verifyPayment);

// Student sees their own payment history
paymentRouter.get("/my", getMyPayments);

// Admin sees full payment history
paymentRouter.get("/history", requireRole("admin"), getPaymentHistory);

export { paymentRouter };
