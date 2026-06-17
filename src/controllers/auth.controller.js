import fs from "fs";
import { asyncHandler } from "../utils/asyncHandler.js";
import {
  registerUserService,
  loginUserService,
  generateAndStoreVerificationCode,
  verifyEmailService,
  resendVerificationService,
  resolveReferral,
  getCurrentUserService,
  getUsersService,
  updateAvatarService,
  changePasswordService,
  refreshAccessTokenService,
  requestPasswordResetService,
  verifyResetCodeService,
  resetPasswordService,
  googleAuthService,
  completeProfileService,
} from "../services/auth.service.js";
import { sendVerificationMail, sendPasswordResetMail } from "../utils/mail.util.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { cookieOptions } from "../middlewares/cookie.options.js";

export const registerUser = asyncHandler(async (req, res) => {
  const { full_name, email, password, role, phone, location, referralCode } = req.body;

  if (role === "admin") throw new ApiError(401, "Admin user can't be registered");
  if (!full_name || !email || !password || !role || !phone || !location) {
    throw new ApiError(400, "All fields are required");
  }

  const referredBy = await resolveReferral(referralCode);
  const user = await registerUserService({
    full_name, email, password, role, phone, location, referredBy,
  });

  // Email a verification code. Non-blocking: if mail fails the account still
  // exists (login is allowed) and the user can request a fresh code.
  try {
    const code = await generateAndStoreVerificationCode(user.id);
    await sendVerificationMail({ name: user.full_name, email: user.email, code });
  } catch (err) {
    console.error(`Verification email failed for ${email}:`, err.message);
  }

  return res
    .status(201)
    .json(new ApiResponse(201, { ...user, is_verified: false }, "User registered successfully"));
});

// POST /auth/verify-email  (public) — confirm an emailed OTP
export const verifyEmail = asyncHandler(async (req, res) => {
  const { email, code } = req.body;
  if (!email || !code) throw new ApiError(400, "Email and code are required");

  const { alreadyVerified } = await verifyEmailService({ email, code });
  return res.status(200).json(
    new ApiResponse(200, { verified: true }, alreadyVerified ? "Email already verified" : "Email verified successfully")
  );
});

// POST /auth/resend-verification  (public) — issue a fresh OTP
export const resendVerification = asyncHandler(async (req, res) => {
  const { email } = req.body;
  if (!email) throw new ApiError(400, "Email is required");

  const { name, code } = await resendVerificationService({ email });
  await sendVerificationMail({ name, email, code });

  return res.status(200).json(new ApiResponse(200, {}, "Verification code sent"));
});

// POST /auth/forgot-password  (public) — email a reset code if the account exists
export const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;
  if (!email) throw new ApiError(400, "Email is required");

  const result = await requestPasswordResetService({ email });
  // Only send mail if the account exists, but ALWAYS respond the same way so we
  // don't reveal which emails are registered.
  if (result) {
    try {
      await sendPasswordResetMail(result);
    } catch (err) {
      console.error(`Password reset email failed for ${email}:`, err.message);
    }
  }

  return res.status(200).json(
    new ApiResponse(200, {}, "If an account with that email exists, a reset code has been sent.")
  );
});

// POST /auth/verify-reset-code  (public) — soft check before showing the new-password field
export const verifyResetCode = asyncHandler(async (req, res) => {
  const { email, code } = req.body;
  if (!email || !code) throw new ApiError(400, "Email and code are required");

  await verifyResetCodeService({ email, code });
  return res.status(200).json(new ApiResponse(200, { valid: true }, "Code verified"));
});

// POST /auth/reset-password  (public) — set a new password using a valid code
export const resetPassword = asyncHandler(async (req, res) => {
  const { email, code, newPassword } = req.body;
  if (!email || !code || !newPassword) {
    throw new ApiError(400, "Email, code and new password are required");
  }

  await resetPasswordService({ email, code, newPassword });
  return res.status(200).json(new ApiResponse(200, {}, "Password reset successfully. Please sign in."));
});

export const loginUser = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const { user, accessToken, refreshToken } = await loginUserService({ email, password });

  return res
    .status(200)
    .cookie("accessToken", accessToken, cookieOptions)
    .cookie("refreshToken", refreshToken, cookieOptions)
    .json(new ApiResponse(200, { user, accessToken }, "Login successful"));
});

// POST /auth/google  (public) — sign in / sign up with a Google ID token
export const googleAuth = asyncHandler(async (req, res) => {
  const { idToken, role } = req.body;
  const { user, accessToken, refreshToken, profileComplete } = await googleAuthService({ idToken, role });

  return res
    .status(200)
    .cookie("accessToken", accessToken, cookieOptions)
    .cookie("refreshToken", refreshToken, cookieOptions)
    .json(new ApiResponse(200, { user, accessToken, profileComplete }, "Google sign-in successful"));
});

// PATCH /auth/complete-profile  (logged-in) — fill phone/location after Google sign-up
export const completeProfile = asyncHandler(async (req, res) => {
  const { phone, location } = req.body;
  const user = await completeProfileService({ userId: req.user.id, phone, location });
  return res.status(200).json(new ApiResponse(200, user, "Profile completed"));
});

export const logoutUser = asyncHandler(async (req, res) => {
  return res
    .status(200)
    .clearCookie("accessToken", cookieOptions)
    .clearCookie("refreshToken", cookieOptions)
    .json(new ApiResponse(200, {}, "Logout successful"));
});

export const getCurrentUser = asyncHandler(async (req, res) => {
  const user = await getCurrentUserService(req.user.id);
  return res.status(200).json(new ApiResponse(200, user, "Current user fetched successfully"));
});

// GET /auth/users?role=instructor&page=1&limit=20  (admin only)
export const getUsers = asyncHandler(async (req, res) => {
  const data = await getUsersService(req.query);
  return res.status(200).json(new ApiResponse(200, data));
});

// PATCH /auth/avatar  (any logged-in user) — multipart/form-data, field "avatar"
export const updateAvatar = asyncHandler(async (req, res) => {
  if (!req.file) throw new ApiError(400, "No avatar image provided (field name: 'avatar')");
  try {
    const user = await updateAvatarService({ userId: req.user.id, filePath: req.file.path });
    return res.status(200).json(new ApiResponse(200, user, "Avatar updated successfully"));
  } finally {
    // multer wrote a temp file — always clean it up
    if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
  }
});

// POST /auth/change-password  (any logged-in user)
export const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    throw new ApiError(400, "Current and new password are required");
  }
  await changePasswordService({ userId: req.user.id, currentPassword, newPassword });
  return res.status(200).json(new ApiResponse(200, {}, "Password updated successfully"));
});

export const refreshAccessToken = asyncHandler(async (req, res) => {
  const newAccessToken = await refreshAccessTokenService(req.cookies?.refreshToken);
  return res
    .status(200)
    .cookie("accessToken", newAccessToken, cookieOptions)
    .json(new ApiResponse(200, { accessToken: newAccessToken }, "Token refreshed"));
});
