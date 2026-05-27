import { ApiError } from "../utils/ApiError.js";

export const validate = (schema) => {
  return (req, res, next) => {
    try {
      schema.parse(req.body);

      next();
    } catch (error) {
      const formattedErrors = error.errors.map((err) => ({
        field: err.path[0],
        message: err.message,
      }));

      next(new ApiError(400, "Validation failed", formattedErrors));
    }
  };
};
