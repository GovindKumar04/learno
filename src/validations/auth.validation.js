import { z } from "zod";

// "admin" removed from role enum - admins can't self-register
export const registerSchema = z.object({
  full_name: z
    .string()
    .min(3, "Full name must be at least 3 characters")
    .max(100),
  email: z.string().email("Invalid email"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  role: z.enum(["student", "instructor"]),
  phone: z.string().regex(/^[6-9]\d{9}$/, "Invalid phone number"),
  location: z
    .string()
    .min(2, "Location must be at least 2 characters")
    .max(255, "Location too long"),
});

export const loginSchema = z.object({
  email: z.string().email("Invalid email"),
  password: z.string().min(6, "Password is required"),
});

export const verifyEmailSchema = z.object({
  email: z.string().email("Invalid email"),
  code: z.string().regex(/^\d{6}$/, "Code must be 6 digits"),
});

export const resendVerificationSchema = z.object({
  email: z.string().email("Invalid email"),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email("Invalid email"),
});

export const verifyResetCodeSchema = z.object({
  email: z.string().email("Invalid email"),
  code: z.string().regex(/^\d{6}$/, "Code must be 6 digits"),
});

export const resetPasswordSchema = z.object({
  email: z.string().email("Invalid email"),
  code: z.string().regex(/^\d{6}$/, "Code must be 6 digits"),
  newPassword: z.string().min(6, "Password must be at least 6 characters"),
});

export const googleAuthSchema = z.object({
  idToken: z.string().min(1, "Google credential is required"),
  role: z.enum(["student", "instructor"]).optional(),
});

export const completeProfileSchema = z.object({
  phone: z.string().regex(/^[6-9]\d{9}$/, "Invalid phone number"),
  location: z.string().min(2, "Location must be at least 2 characters").max(255),
});
