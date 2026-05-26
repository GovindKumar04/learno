import { z } from "zod";

export const registerSchema = z.object({
  full_name: z
    .string()
    .min(3, "Full name must be at least 3 characters")
    .max(100),

  email: z.string().email("Invalid email"),

  password: z.string().min(6, "Password must be at least 6 characters"),

  role: z.enum(["student", "instructor", "admin"]),

  phone: z
    .string()
    .regex(/^[6-9]\d{9}$/, "Invalid phone number"),

  location: z
    .string()
    .min(2, "Location must be at least 2 characters")
    .max(255, "Location too long"),
});

export const loginSchema = z.object({
  email: z.string().email("Invalid email"),

  password: z.string().min(6, "Password is required"),
});
