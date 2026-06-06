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
} from "../controllers/auth.controller.js";
import { validate } from "../middlewares/validate.middleware.js";
import { registerSchema, loginSchema, verifyEmailSchema, resendVerificationSchema } from "../validations/auth.validation.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";
import { requireRole } from "../middlewares/role.middleware.js";
import { upload } from "../middlewares/multer.middleware.js";

const authrouter = express.Router();

authrouter.post("/register", validate(registerSchema), registerUser);
authrouter.post("/verify-email", validate(verifyEmailSchema), verifyEmail);
authrouter.post("/resend-verification", validate(resendVerificationSchema), resendVerification);
authrouter.post("/login", validate(loginSchema), loginUser);
authrouter.post("/logout", logoutUser);
authrouter.post("/refresh", refreshAccessToken);
authrouter.get("/me", verifyJWT, getCurrentUser);
authrouter.patch("/avatar", verifyJWT, upload.single("avatar"), updateAvatar);
authrouter.post("/change-password", verifyJWT, changePassword);
authrouter.get("/users", verifyJWT, requireRole("admin"), getUsers);

export { authrouter };
