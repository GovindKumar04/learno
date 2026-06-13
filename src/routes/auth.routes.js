import express from "express";
import {
  registerUser,
  verifyEmail,
  resendVerification,
  loginUser,
  logoutUser,
  getCurrentUser,
  refreshAccessToken,
  getUsers,
  changePassword,
  updateAvatar,
  forgotPassword,
  verifyResetCode,
  resetPassword,
  googleAuth,
  completeProfile,
} from "../controllers/auth.controller.js";
import { validate } from "../middlewares/validate.middleware.js";
import {
  registerSchema,
  loginSchema,
  verifyEmailSchema,
  resendVerificationSchema,
  forgotPasswordSchema,
  verifyResetCodeSchema,
  resetPasswordSchema,
  googleAuthSchema,
  completeProfileSchema,
} from "../validations/auth.validation.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";
import { requireRole } from "../middlewares/role.middleware.js";
import { upload } from "../middlewares/multer.middleware.js";
import { authLimiter } from "../middlewares/rateLimit.middleware.js";

const authrouter = express.Router();

authrouter.post("/register", authLimiter, validate(registerSchema), registerUser);
authrouter.post("/verify-email", authLimiter, validate(verifyEmailSchema), verifyEmail);
authrouter.post("/resend-verification", authLimiter, validate(resendVerificationSchema), resendVerification);
authrouter.post("/login", authLimiter, validate(loginSchema), loginUser);
authrouter.post("/google", authLimiter, validate(googleAuthSchema), googleAuth);
authrouter.post("/forgot-password", authLimiter, validate(forgotPasswordSchema), forgotPassword);
authrouter.post("/verify-reset-code", authLimiter, validate(verifyResetCodeSchema), verifyResetCode);
authrouter.post("/reset-password", authLimiter, validate(resetPasswordSchema), resetPassword);
authrouter.post("/logout", logoutUser);
authrouter.post("/refresh", refreshAccessToken);
authrouter.get("/me", verifyJWT, getCurrentUser);
authrouter.patch("/complete-profile", verifyJWT, validate(completeProfileSchema), completeProfile);
authrouter.patch("/avatar", verifyJWT, upload.single("avatar"), updateAvatar);
authrouter.post("/change-password", verifyJWT, authLimiter, changePassword);
authrouter.get("/users", verifyJWT, requireRole("admin"), getUsers);

export { authrouter };
