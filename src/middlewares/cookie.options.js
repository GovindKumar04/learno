// In production the frontend and API are on different domains (e.g. the client
// vs learno-2.onrender.com), so the auth cookies are sent cross-site. Browsers
// only attach cross-site cookies when SameSite=None AND Secure are both set.
// (SameSite=Strict/Lax silently drops the cookie on cross-site XHR — which logs
// the user out on every refresh.) Locally we stay on lax/non-secure for http.
const isProd = process.env.NODE_ENV === "production";

export const cookieOptions = {
  httpOnly: true,
  secure: isProd,
  sameSite: isProd ? "none" : "lax",
};
