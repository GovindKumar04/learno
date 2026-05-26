import { asyncHandler } from "../utils/asyncHandler.js";
import {
  registerUserService,
  loginUserService,
} from "../services/auth.service.js";
import { ApiError } from "../utils/ApiErrors.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import pool from "../config/db.js";

const cookieOptions = {
  httpOnly: true,
  secure: false,
  sameSite: "lax",
};

export const registerUser = asyncHandler(async (req, res) => {
  const { full_name, email, password, role, phone, location } = req.body;

  if (!full_name || !email || !password || !role || !phone || !location) {
    throw new ApiError(400, "All fields are required");
  }

  const user = await registerUserService({
    full_name,
    email,
    password,
    role,
    phone,
    location
  });

  return res
    .status(201)
    .json(new ApiResponse(201, user, "User registered successfully"));
});

export const loginUser = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const { user, accessToken, refreshToken } = await loginUserService({
    email,
    password,
  });

  return res
    .status(200)
    .cookie("accessToken", accessToken, cookieOptions)
    .cookie("refreshToken", refreshToken, cookieOptions)
    .json(
      new ApiResponse(
        200,
        {
          user,
          accessToken,
        },
        "Login successful",
      ),
    );
});

export const logoutUser = asyncHandler(async (req, res) => {
  return res
    .status(200)
    .clearCookie("accessToken")
    .clearCookie("refreshToken")
    .json(new ApiResponse(200, {}, "Logout successful"));
});

export const getCurrentUser = asyncHandler(async (req, res) => {
  // comes from verifyJWT middleware
  const userId = req.user.id;

  const result = await pool.query(
    `
    SELECT 
      id,
      full_name,
      email,
      role,
      phone,
      avatar,
      is_verified,
      is_active,
      created_at
    FROM users
    WHERE id = $1
    `,
    [userId],
  );

  if (result.rows.length === 0) {
    throw new ApiError(404, "User not found");
  }

  return res
    .status(200)
    .json(
      new ApiResponse(200, result.rows[0], "Current user fetched successfully"),
    );
});
