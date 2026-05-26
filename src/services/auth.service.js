import bcrypt from "bcrypt";
import pool from "../config/db.js";

import { ApiError } from "../utils/ApiErrors.js";

import {
  generateAccessToken,
  generateRefreshToken,
} from "../utils/jwt.js";

export const registerUserService = async ({
  full_name,
  email,
  password,
  role,
  phone,
  location
}) => {

  const existingUser = await pool.query(
    `
    SELECT * FROM users
    WHERE email = $1
    `,
    [email]
  );

  if (existingUser.rows.length > 0) {
    throw new ApiError(409, "User already exists");
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  const result = await pool.query(
    `
    INSERT INTO users
    (
      full_name,
      email,
      password,
      role,
      phone,
      location
    )
    VALUES
    ($1, $2, $3, $4, $5, $6)

    RETURNING
    id,
    full_name,
    email,
    role,
    avatar,
    phone,
    location,
    created_at
    `,
    [full_name, email, hashedPassword, role, phone, location || "student"]
  );

  return result.rows[0];
};

export const loginUserService = async ({
  email,
  password,
}) => {

  const userResult = await pool.query(
    `
    SELECT * FROM users
    WHERE email = $1
    `,
    [email]
  );

  if (userResult.rows.length === 0) {
    throw new ApiError(404, "User not found");
  }

  const user = userResult.rows[0];

  const isPasswordCorrect = await bcrypt.compare(
    password,
    user.password
  );

  if (!isPasswordCorrect) {
    throw new ApiError(401, "Invalid credentials");
  }

  const accessToken = generateAccessToken(user);

  const refreshToken = generateRefreshToken(user);

  await pool.query(
    `
    UPDATE users
    SET refresh_token = $1
    WHERE id = $2
    `,
    [refreshToken, user.id]
  );

  delete user.password;
  delete user.refresh_token;

  return {
    user,
    accessToken,
    refreshToken,
  };
};