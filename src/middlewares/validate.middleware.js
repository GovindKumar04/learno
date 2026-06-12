import { ApiError } from "../utils/ApiError.js";

export const validate = (schema) => {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);

    if (result.success) {
      return next();
    }

    const issues = result.error?.issues ?? result.error?.errors ?? [];

    const formattedErrors = issues.map((issue) => ({
      field: issue.path?.[0] ?? "unknown",
      message: issue.message,
    }));

    return next(new ApiError(400, "Validation failed", formattedErrors));
  };
};
