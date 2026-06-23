import { ApiError } from "./ApiError.js";

// WhatsApp greet/welcome message via Fillip's WhatsApp API.
// Base URL is overridable via env so staging can point elsewhere; falls back to prod.
const WHATSAPP_API_URL =
  process.env.WHATSAPP_API_URL || "https://whatsapapi.fillipsoftware.com/api/send/greed/message";

// Normalize an Indian mobile to the country-code form the API expects ("91XXXXXXXXXX").
// Strips spaces/dashes/+, prepends 91 for a bare 10-digit number, and leaves an
// already-prefixed (12-digit) number untouched. Returns null if it can't be made valid.
const normalizeMobile = (phone) => {
  const digits = String(phone || "").replace(/\D/g, "");
  if (/^[6-9]\d{9}$/.test(digits)) return `91${digits}`;      // bare 10-digit Indian number
  if (/^91[6-9]\d{9}$/.test(digits)) return digits;           // already country-code prefixed
  return null;
};

// Sends the "welcome + thanks for buying the course" WhatsApp greeting to a student.
// Non-blocking by design: enrollment/payment must never fail because WhatsApp is down,
// so this logs and returns instead of throwing (mirrors sendPaymentConfirmation).
// Returns true if the API accepted the message, false otherwise.
export const sendCourseWelcomeWhatsApp = async ({ name, phone, courseName }) => {
  const mobile = normalizeMobile(phone);
  if (!mobile) {
    console.warn(`WhatsApp welcome skipped — invalid/missing phone for ${name || "student"}`);
    return false;
  }

  try {
    // Abort if the WhatsApp API hangs, so we don't tie up the enrollment response.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    const res = await fetch(WHATSAPP_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mobile,
        student_name: name || "Student",
        course_name: courseName,
      }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));

    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.success === false) {
      console.error(`WhatsApp welcome failed for ${mobile}:`, data?.message || `HTTP ${res.status}`);
      return false;
    }
    return true;
  } catch (error) {
    console.error(`WhatsApp welcome error for ${mobile}:`, error.message);
    return false;
  }
};

// Throwing variant for callers that want to surface failures (kept for parity with
// mail.util.js helpers that throw). Currently unused by the enrollment flows.
export const sendCourseWelcomeWhatsAppStrict = async (args) => {
  const ok = await sendCourseWelcomeWhatsApp(args);
  if (!ok) throw new ApiError(502, "Failed to send WhatsApp welcome message");
};
