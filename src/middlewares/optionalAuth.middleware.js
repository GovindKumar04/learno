// middlewares/optionalAuth.middleware.js

import jwt from "jsonwebtoken";

export const optionalAuth = (req, res, next) => {
  try {
    // Get token from cookie OR Authorization header
    const token =
      req.cookies?.accessToken ||
      req.headers.authorization?.replace("Bearer ", "");

    // No token = guest user
    if (!token) {
      req.user = null;
      return next();
    }

    // Verify token
    const decoded = jwt.verify(
      token,
      process.env.ACCESS_TOKEN_SECRET
    );

    // Attach user data to request
    req.user = decoded;

    next();
  } catch (error) {
    // Invalid token → still continue as guest
    req.user = null;
    next();
  }
};