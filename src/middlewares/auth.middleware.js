import jwt from "jsonwebtoken";

import { ApiError } from "../utils/ApiErrors.js";

const verifyJWT = (req, res, next) => {
  try {
    const token = req.cookies?.accessToken;

    if (!token) {
      throw new ApiError(401, "Unauthorized");
    }

    const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);

    req.user = decoded;

    next();
  } catch (error) {
    next(new ApiError(401, "Invalid token"));
  }
};

export { verifyJWT };
