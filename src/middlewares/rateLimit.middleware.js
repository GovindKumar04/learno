import rateLimit from "express-rate-limit";
import { ApiError } from "../utils/ApiError.js";

// Shared rate limiters. 429s are funneled through ApiError so they come back in
// the same response shape as every other error (see global handler in app.js).
//
// Keyed per client IP (req.ip). For that to be the *real* client and not the
// Nginx box, app.js sets `trust proxy`. These use the default in-memory store —
// correct for the current single-process VPS deploy. If we scale to PM2 cluster
// or multiple boxes, swap in a shared Redis store so the window is global.

const makeLimiter = ({ windowMs, max, message }) =>
  rateLimit({
    windowMs,
    limit: max,
    standardHeaders: "draft-7", // RateLimit-* headers so clients can back off
    legacyHeaders: false,
    handler: (req, res, next) => next(new ApiError(429, message)),
  });

// General protection for every route. Generous on purpose — a logged-in SPA
// makes many calls per page, so this only catches scrapers / floods.
export const apiLimiter = makeLimiter({
  windowMs: 5 * 60_000,
  max: 600,
  message: "Too many requests — please slow down and try again shortly.",
});

// Credential endpoints (login/register/OTP). Tight, to blunt brute-force and
// account-enumeration. Not applied to /auth/me or /auth/refresh, which the SPA
// hits routinely and which already require a valid token.
export const authLimiter = makeLimiter({
  windowMs: 15 * 60_000,
  max: 30,
  message: "Too many attempts — please wait a few minutes and try again.",
});

// Costly or abusable actions: outbound mail, payment order creation.
export const sensitiveLimiter = makeLimiter({
  windowMs: 15 * 60_000,
  max: 50,
  message: "Too many requests — please wait before trying again.",
});
