import fs from "fs";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { sendDirectMail } from "../utils/mail.util.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ─────────────────────────────────────────────────────────────────────────────
// POST /mail/send  (admin only, multipart)
// Body: { to, subject, message } + attachments[] files
//   to → one or more emails (comma / semicolon / newline separated)
// ─────────────────────────────────────────────────────────────────────────────
const sendMail = asyncHandler(async (req, res) => {
  const { to, subject, message } = req.body;
  const files = req.files || [];

  // Always remove the temp upload files, success or failure.
  const cleanup = () =>
    files.forEach((f) => {
      try { if (fs.existsSync(f.path)) fs.unlinkSync(f.path); } catch { /* ignore */ }
    });

  try {
    if (!to?.trim() || !subject?.trim() || !message?.trim()) {
      throw new ApiError(400, "to, subject and message are required");
    }

    const recipients = to.split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean);
    if (recipients.length === 0) throw new ApiError(400, "Provide at least one recipient email");

    const invalid = recipients.filter((e) => !EMAIL_RE.test(e));
    if (invalid.length) throw new ApiError(400, `Invalid email address(es): ${invalid.join(", ")}`);

    const attachments = files.map((f) => ({ filename: f.originalname, path: f.path }));

    await sendDirectMail({
      to: recipients,
      subject: subject.trim(),
      message: message.trim(),
      attachments,
    });

    return res.json(
      new ApiResponse(
        200,
        { recipients: recipients.length, attachments: attachments.length },
        `Email sent to ${recipients.length} recipient(s)${attachments.length ? ` with ${attachments.length} attachment(s)` : ""}`
      )
    );
  } finally {
    cleanup();
  }
});

export { sendMail };
