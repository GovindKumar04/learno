import { ApiError } from "../utils/ApiError.js";

// Lightweight in-memory fixed-window rate limiter for the (public, paid) chat
// endpoint. Keyed per signed-in user, else per IP. Single-process only — fine
// for the current single-VPS deploy; move to a shared store if scaled out.
const WINDOW_MS = 60_000;
const MAX_REQUESTS = 20;

const hits = new Map();
let lastPrune = Date.now();

const prune = (now) => {
  for (const [key, entry] of hits) {
    if (now > entry.resetAt) hits.delete(key);
  }
  lastPrune = now;
};

export const chatLimiter = (req, _res, next) => {
  const now = Date.now();
  if (now - lastPrune > WINDOW_MS) prune(now);

  const key = req.user?.id ? `u:${req.user.id}` : `ip:${req.ip}`;
  const entry = hits.get(key);
  
  if (!entry || now > entry.resetAt) {
    hits.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return next();
  }
  if (entry.count >= MAX_REQUESTS) {
    return next(new ApiError(429, "Too many messages — please wait a moment and try again."));
  }
  entry.count += 1;
  next();
};
