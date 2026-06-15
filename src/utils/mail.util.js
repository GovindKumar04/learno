import { transporter } from "../config/nodemailer.js";
import { ApiError } from "./ApiError.js";

// ─── Confirmation mail to user after submitting enquiry ───
export const sendConfirmationMail = async ({ name, email, subject, message, ticketId }) => {
  try {
    await transporter.sendMail({
      from: `"Fillip Skill Academy" <${process.env.SMTP_USER}>`,
      to: email,
      subject: `[${ticketId}] We received your enquiry!`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #2563eb;">Hi ${name}, we got your message!</h2>
          <p>Your ticket ID is <strong>${ticketId}</strong>. 
             Use this to follow up with us anytime.</p>
          <p>Our team will get back to you within <strong>24 hours</strong>.</p>
          <hr style="border: none; border-top: 1px solid #e5e7eb;" />
          <p><strong>Your message:</strong></p>
          <blockquote style="border-left: 4px solid #2563eb; padding-left: 12px; color: #374151;">
            ${message}
          </blockquote>
          <hr style="border: none; border-top: 1px solid #e5e7eb;" />
          <p>You can also reach us directly:</p>
          <ul>
            <li>📞 Call: <a href="tel:${process.env.ADMIN_PHONE}">${process.env.ADMIN_PHONE}</a></li>
            <li>📧 Email: <a href="mailto:${process.env.ADMIN_EMAIL}">${process.env.ADMIN_EMAIL}</a></li>
          </ul>
          <p style="color: #6b7280; font-size: 12px;">Fillip Skill Academy Team</p>
        </div>
      `,
    });
  } catch (error) {
    throw new ApiError(500, `Failed to send confirmation email: ${error.message}`);
  }
};

// ─── Email verification code (OTP) at registration ────────
// Throws on failure so the caller can tell the user to retry / resend.
export const sendVerificationMail = async ({ name, email, code }) => {
  await transporter.sendMail({
    from: `"Fillip Skill Academy" <${process.env.SMTP_USER}>`,
    to: email,
    subject: `${code} is your Fillip verification code`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f9fafb; padding: 24px; border-radius: 12px;">
        <div style="background: #1e3a8a; color: white; padding: 24px; border-radius: 8px; text-align: center; margin-bottom: 24px;">
          <h1 style="margin: 0; font-size: 22px;">Verify your email</h1>
          <p style="margin: 8px 0 0; opacity: 0.85;">Fillip Skill Academy</p>
        </div>
        <div style="background: white; padding: 24px; border-radius: 8px; border: 1px solid #e5e7eb; text-align: center;">
          <p style="color: #374151; font-size: 16px;">Hi <strong>${name || "there"}</strong>,</p>
          <p style="color: #374151;">Use this code to verify your email address:</p>
          <div style="font-size: 34px; font-weight: 800; letter-spacing: 10px; color: #1e3a8a; background: #eff6ff; border-radius: 8px; padding: 16px; margin: 16px auto; display: inline-block;">
            ${code}
          </div>
          <p style="color: #6b7280; font-size: 13px;">This code expires in 15 minutes. If you didn't create a Fillip account, you can ignore this email.</p>
        </div>
        <p style="color: #9ca3af; font-size: 12px; text-align: center; margin-top: 16px;">
          Questions? Contact us at <a href="mailto:${process.env.ADMIN_EMAIL}" style="color: #2563eb;">${process.env.ADMIN_EMAIL}</a>
        </p>
      </div>
    `,
  });
};

// ─── Password reset code (OTP) ────────────────────────────
// Throws on failure so the caller can tell the user to retry.
export const sendPasswordResetMail = async ({ name, email, code }) => {
  await transporter.sendMail({
    from: `"Fillip Skill Academy" <${process.env.SMTP_USER}>`,
    to: email,
    subject: `${code} is your Fillip password reset code`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f9fafb; padding: 24px; border-radius: 12px;">
        <div style="background: #1e3a8a; color: white; padding: 24px; border-radius: 8px; text-align: center; margin-bottom: 24px;">
          <h1 style="margin: 0; font-size: 22px;">Reset your password</h1>
          <p style="margin: 8px 0 0; opacity: 0.85;">Fillip Skill Academy</p>
        </div>
        <div style="background: white; padding: 24px; border-radius: 8px; border: 1px solid #e5e7eb; text-align: center;">
          <p style="color: #374151; font-size: 16px;">Hi <strong>${name || "there"}</strong>,</p>
          <p style="color: #374151;">Use this code to reset your password:</p>
          <div style="font-size: 34px; font-weight: 800; letter-spacing: 10px; color: #1e3a8a; background: #eff6ff; border-radius: 8px; padding: 16px; margin: 16px auto; display: inline-block;">
            ${code}
          </div>
          <p style="color: #6b7280; font-size: 13px;">This code expires in 15 minutes. If you didn't request a password reset, you can safely ignore this email — your password won't change.</p>
        </div>
        <p style="color: #9ca3af; font-size: 12px; text-align: center; margin-top: 16px;">
          Questions? Contact us at <a href="mailto:${process.env.ADMIN_EMAIL}" style="color: #2563eb;">${process.env.ADMIN_EMAIL}</a>
        </p>
      </div>
    `,
  });
};

// ─── Payment confirmation to student ──────────────────────
export const sendPaymentConfirmation = async ({ name, email, courseName, enrollmentType, amountINR, paymentId }) => {
  try {
    await transporter.sendMail({
      from: `"Fillip Skill Academy" <${process.env.SMTP_USER}>`,
      to: email,
      subject: `Payment Confirmed — ${courseName}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f9fafb; padding: 24px; border-radius: 12px;">
          <div style="background: #1e3a8a; color: white; padding: 24px; border-radius: 8px; text-align: center; margin-bottom: 24px;">
            <h1 style="margin: 0; font-size: 24px;">Payment Confirmed ✓</h1>
            <p style="margin: 8px 0 0; opacity: 0.8;">Fillip Skill Academy</p>
          </div>
          <div style="background: white; padding: 24px; border-radius: 8px; border: 1px solid #e5e7eb;">
            <p style="color: #374151; font-size: 16px;">Hi <strong>${name}</strong>,</p>
            <p style="color: #374151;">Your payment was successful and you are now enrolled in:</p>
            <div style="background: #eff6ff; border-left: 4px solid #2563eb; padding: 16px; border-radius: 4px; margin: 16px 0;">
              <p style="margin: 0; font-size: 18px; font-weight: bold; color: #1e3a8a;">${courseName}</p>
              <p style="margin: 4px 0 0; color: #6b7280; font-size: 14px; text-transform: capitalize;">${enrollmentType} Enrollment</p>
            </div>
            <table style="width: 100%; border-collapse: collapse; margin-top: 16px;">
              <tr style="border-bottom: 1px solid #f3f4f6;">
                <td style="padding: 10px 0; color: #6b7280; font-size: 14px;">Amount Paid</td>
                <td style="padding: 10px 0; text-align: right; font-weight: bold; color: #111827;">₹${amountINR.toLocaleString()}</td>
              </tr>
              <tr style="border-bottom: 1px solid #f3f4f6;">
                <td style="padding: 10px 0; color: #6b7280; font-size: 14px;">Payment ID</td>
                <td style="padding: 10px 0; text-align: right; font-family: monospace; font-size: 13px; color: #374151;">${paymentId}</td>
              </tr>
              <tr>
                <td style="padding: 10px 0; color: #6b7280; font-size: 14px;">Enrollment Type</td>
                <td style="padding: 10px 0; text-align: right; font-weight: 600; color: #059669; text-transform: capitalize;">${enrollmentType}</td>
              </tr>
            </table>
            <div style="margin-top: 24px; text-align: center;">
              <a href="${process.env.CLIENT_URL || "http://localhost:5173"}/student/my-courses"
                 style="background: #1e3a8a; color: white; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; display: inline-block;">
                Go to My Courses
              </a>
            </div>
          </div>
          <p style="color: #9ca3af; font-size: 12px; text-align: center; margin-top: 16px;">
            Questions? Contact us at <a href="mailto:${process.env.ADMIN_EMAIL}" style="color: #2563eb;">${process.env.ADMIN_EMAIL}</a>
          </p>
        </div>
      `,
    });
  } catch (error) {
    console.error("Payment email failed:", error.message);
  }
};

// ─── Batch assignment notification (instructor + students) ─
export const sendBatchAssignmentMail = async ({ name, email, role, courseName, batchName, schedule, location }) => {
  try {
    const roleLine =
      role === "instructor"
        ? "You have been assigned to teach the following offline batch:"
        : "You have been assigned to the following offline batch:";

    await transporter.sendMail({
      from: `"Fillip Skill Academy" <${process.env.SMTP_USER}>`,
      to: email,
      subject: `Batch Assigned — ${batchName} (${courseName})`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f9fafb; padding: 24px; border-radius: 12px;">
          <div style="background: #4f46e5; color: white; padding: 24px; border-radius: 8px; text-align: center; margin-bottom: 24px;">
            <h1 style="margin: 0; font-size: 22px;">Batch Assigned 🎓</h1>
            <p style="margin: 8px 0 0; opacity: 0.85;">Fillip Skill Academy</p>
          </div>
          <div style="background: white; padding: 24px; border-radius: 8px; border: 1px solid #e5e7eb;">
            <p style="color: #374151; font-size: 16px;">Hi <strong>${name}</strong>,</p>
            <p style="color: #374151;">${roleLine}</p>
            <div style="background: #eef2ff; border-left: 4px solid #4f46e5; padding: 16px; border-radius: 4px; margin: 16px 0;">
              <p style="margin: 0; font-size: 18px; font-weight: bold; color: #3730a3;">${batchName}</p>
              <p style="margin: 4px 0 0; color: #6b7280; font-size: 14px;">${courseName}</p>
            </div>
            <table style="width: 100%; border-collapse: collapse; margin-top: 8px;">
              <tr style="border-bottom: 1px solid #f3f4f6;">
                <td style="padding: 10px 0; color: #6b7280; font-size: 14px;">🕒 Timing</td>
                <td style="padding: 10px 0; text-align: right; font-weight: 600; color: #111827;">${schedule || "To be announced"}</td>
              </tr>
              <tr style="border-bottom: 1px solid #f3f4f6;">
                <td style="padding: 10px 0; color: #6b7280; font-size: 14px;">📍 Location</td>
                <td style="padding: 10px 0; text-align: right; font-weight: 600; color: #111827;">${location || "To be announced"}</td>
              </tr>
              <tr>
                <td style="padding: 10px 0; color: #6b7280; font-size: 14px;">🏫 Mode</td>
                <td style="padding: 10px 0; text-align: right; font-weight: 600; color: #ea580c;">Offline</td>
              </tr>
            </table>
          </div>
          <p style="color: #9ca3af; font-size: 12px; text-align: center; margin-top: 16px;">
            Questions? Contact us at <a href="mailto:${process.env.ADMIN_EMAIL}" style="color: #4f46e5;">${process.env.ADMIN_EMAIL}</a>
          </p>
        </div>
      `,
    });
  } catch (error) {
    // Non-critical — don't block batch creation if mail fails
    console.error(`Batch assignment email failed for ${email}:`, error.message);
  }
};

// ─── Online (Zoom) class scheduled / updated ─────────────────
export const sendOnlineClassMail = async ({ name, email, role, courseName, title, joinUrl, meetingId, passcode, when }) => {
  try {
    const roleLine =
      role === "instructor"
        ? "You're scheduled to take the following live online class:"
        : "A live online class has been scheduled for your course:";

    await transporter.sendMail({
      from: `"Fillip Skill Academy" <${process.env.SMTP_USER}>`,
      to: email,
      subject: `Live Class — ${title} (${courseName})`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f9fafb; padding: 24px; border-radius: 12px;">
          <div style="background: #4f46e5; color: white; padding: 24px; border-radius: 8px; text-align: center; margin-bottom: 24px;">
            <h1 style="margin: 0; font-size: 22px;">Live Online Class 🎥</h1>
            <p style="margin: 8px 0 0; opacity: 0.85;">Fillip Skill Academy</p>
          </div>
          <div style="background: white; padding: 24px; border-radius: 8px; border: 1px solid #e5e7eb;">
            <p style="color: #374151; font-size: 16px;">Hi <strong>${name}</strong>,</p>
            <p style="color: #374151;">${roleLine}</p>
            <div style="background: #eef2ff; border-left: 4px solid #4f46e5; padding: 16px; border-radius: 4px; margin: 16px 0;">
              <p style="margin: 0; font-size: 18px; font-weight: bold; color: #3730a3;">${title}</p>
              <p style="margin: 4px 0 0; color: #6b7280; font-size: 14px;">${courseName}</p>
            </div>
            <table style="width: 100%; border-collapse: collapse; margin-top: 8px;">
              <tr style="border-bottom: 1px solid #f3f4f6;">
                <td style="padding: 10px 0; color: #6b7280; font-size: 14px;">🕒 When</td>
                <td style="padding: 10px 0; text-align: right; font-weight: 600; color: #111827;">${when || "To be announced"}</td>
              </tr>
              ${meetingId ? `<tr style="border-bottom: 1px solid #f3f4f6;">
                <td style="padding: 10px 0; color: #6b7280; font-size: 14px;">🆔 Meeting ID</td>
                <td style="padding: 10px 0; text-align: right; font-weight: 600; color: #111827;">${meetingId}</td>
              </tr>` : ""}
              ${passcode ? `<tr style="border-bottom: 1px solid #f3f4f6;">
                <td style="padding: 10px 0; color: #6b7280; font-size: 14px;">🔑 Passcode</td>
                <td style="padding: 10px 0; text-align: right; font-weight: 600; color: #111827;">${passcode}</td>
              </tr>` : ""}
              <tr>
                <td style="padding: 10px 0; color: #6b7280; font-size: 14px;">🏫 Mode</td>
                <td style="padding: 10px 0; text-align: right; font-weight: 600; color: #2563eb;">Live (Zoom / Google Meet)</td>
              </tr>
            </table>
            <div style="text-align: center; margin-top: 20px;">
              <a href="${joinUrl}" style="display: inline-block; background: #2563eb; color: white; text-decoration: none; font-weight: 600; padding: 12px 28px; border-radius: 8px;">Join the live class</a>
            </div>
          </div>
          <p style="color: #9ca3af; font-size: 12px; text-align: center; margin-top: 16px;">
            Questions? Contact us at <a href="mailto:${process.env.ADMIN_EMAIL}" style="color: #4f46e5;">${process.env.ADMIN_EMAIL}</a>
          </p>
        </div>
      `,
    });
  } catch (error) {
    // Non-critical — don't block class scheduling if mail fails
    console.error(`Online class email failed for ${email}:`, error.message);
  }
};

// ─── Affiliate application approved — send login credentials ─
export const sendAffiliateApprovalMail = async ({ name, email, tempPassword, code }) => {
  const loginUrl = `${process.env.CLIENT_URL || "http://localhost:5173"}/auth`;
  try {
    await transporter.sendMail({
      from: `"Fillip Skill Academy" <${process.env.SMTP_USER}>`,
      to: email,
      subject: "You're approved — your Fillip affiliate account is ready 🎉",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f9fafb; padding: 24px; border-radius: 12px;">
          <div style="background: #1e3a8a; color: white; padding: 24px; border-radius: 8px; text-align: center; margin-bottom: 24px;">
            <h1 style="margin: 0; font-size: 22px;">Welcome aboard, ${name}! 🎉</h1>
            <p style="margin: 8px 0 0; opacity: 0.85;">Fillip Skill Academy — Affiliate Program</p>
          </div>
          <div style="background: white; padding: 24px; border-radius: 8px; border: 1px solid #e5e7eb;">
            <p style="color: #374151;">Your affiliate application has been <strong style="color:#059669;">approved</strong>. Use the credentials below to log in to your affiliate dashboard:</p>
            <div style="background: #eff6ff; border-left: 4px solid #2563eb; padding: 16px; border-radius: 4px; margin: 16px 0;">
              <p style="margin: 0 0 6px; color:#374151;"><strong>Login email:</strong> ${email}</p>
              <p style="margin: 0 0 6px; color:#374151;"><strong>Temporary password:</strong> <span style="font-family: monospace; background:#dbeafe; padding:2px 6px; border-radius:4px;">${tempPassword}</span></p>
              <p style="margin: 0; color:#374151;"><strong>Your referral code:</strong> <span style="font-family: monospace;">${code}</span></p>
            </div>
            <p style="color:#6b7280; font-size: 13px;">For your security, please change this password after your first login.</p>
            <div style="margin-top: 24px; text-align: center;">
              <a href="${loginUrl}" style="background: #1e3a8a; color: white; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; display: inline-block;">Log in to your dashboard</a>
            </div>
          </div>
          <p style="color: #9ca3af; font-size: 12px; text-align: center; margin-top: 16px;">
            Questions? Contact us at <a href="mailto:${process.env.ADMIN_EMAIL}" style="color: #2563eb;">${process.env.ADMIN_EMAIL}</a>
          </p>
        </div>
      `,
    });
  } catch (error) {
    // Non-critical — approval already committed; don't fail the request
    console.error(`Affiliate approval email failed for ${email}:`, error.message);
  }
};

// ─── Affiliate application rejected ───────────────────────
export const sendAffiliateRejectionMail = async ({ name, email, note }) => {
  try {
    await transporter.sendMail({
      from: `"Fillip Skill Academy" <${process.env.SMTP_USER}>`,
      to: email,
      subject: "Update on your Fillip affiliate application",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #2563eb;">Hi ${name},</h2>
          <p>Thank you for your interest in the Fillip Skill Academy affiliate program.</p>
          <p>After reviewing your application, we're unable to approve it at this time.</p>
          ${note ? `<blockquote style="border-left: 4px solid #e5e7eb; padding-left: 12px; color: #374151;">${note}</blockquote>` : ""}
          <p>You're welcome to apply again in the future.</p>
          <p style="color: #6b7280; font-size: 12px;">Fillip Skill Academy Team</p>
        </div>
      `,
    });
  } catch (error) {
    console.error(`Affiliate rejection email failed for ${email}:`, error.message);
  }
};

// ─── Generic broadcast mail (admin → student) ─────────────
// Used for bulk announcements (e.g. nudging students who haven't enrolled yet).
// Throws on failure so callers can count successes/failures.
export const sendBroadcastMail = async ({ name, email, subject, message }) => {
  const safeName = name || "there";
  // Plain-text message → preserve the admin's line breaks
  const body = String(message).replace(/\n/g, "<br>");

  await transporter.sendMail({
    from: `"Fillip Skill Academy" <${process.env.SMTP_USER}>`,
    to: email,
    subject,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f9fafb; padding: 24px; border-radius: 12px;">
        <div style="background: #1e3a8a; color: white; padding: 20px; border-radius: 8px; text-align: center; margin-bottom: 20px;">
          <h1 style="margin: 0; font-size: 20px;">Fillip Skill Academy</h1>
        </div>
        <div style="background: white; padding: 24px; border-radius: 8px; border: 1px solid #e5e7eb;">
          <p style="color: #374151; font-size: 16px;">Hi <strong>${safeName}</strong>,</p>
          <div style="color: #374151; line-height: 1.6;">${body}</div>
          <div style="margin-top: 24px; text-align: center;">
            <a href="${process.env.CLIENT_URL || "http://localhost:5173"}/courses"
               style="background: #1e3a8a; color: white; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; display: inline-block;">
              Browse Courses
            </a>
          </div>
        </div>
        <p style="color: #9ca3af; font-size: 12px; text-align: center; margin-top: 16px;">
          Questions? Contact us at <a href="mailto:${process.env.ADMIN_EMAIL}" style="color: #2563eb;">${process.env.ADMIN_EMAIL}</a>
        </p>
      </div>
    `,
  });
};

// ─── Course-completion certificate (admin → student) ──────
// Emails the student their certificate as a PDF attachment.
// Throws on failure so the caller can count successes/failures.
export const sendCertificateMail = async ({ name, email, courseName, certificateNo, pdfBuffer }) => {
  await transporter.sendMail({
    from: `"Fillip Skill Academy" <${process.env.SMTP_USER}>`,
    to: email,
    subject: `🎓 Your Certificate — ${courseName}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f9fafb; padding: 24px; border-radius: 12px;">
        <div style="background: linear-gradient(135deg, #1e3a8a, #4f46e5, #7c3aed); color: white; padding: 28px; border-radius: 8px; text-align: center; margin-bottom: 24px;">
          <h1 style="margin: 0; font-size: 24px;">Congratulations, ${name}! 🎉</h1>
          <p style="margin: 8px 0 0; opacity: 0.9;">Fillip Skill Academy</p>
        </div>
        <div style="background: white; padding: 24px; border-radius: 8px; border: 1px solid #e5e7eb;">
          <p style="color: #374151; font-size: 16px;">We're delighted to award you a <strong>Certificate of Completion</strong> for successfully finishing:</p>
          <div style="background: #eef2ff; border-left: 4px solid #4f46e5; padding: 16px; border-radius: 4px; margin: 16px 0;">
            <p style="margin: 0; font-size: 18px; font-weight: bold; color: #3730a3;">${courseName}</p>
            <p style="margin: 6px 0 0; color: #6b7280; font-size: 13px;">Certificate No: <strong>${certificateNo}</strong></p>
          </div>
          <p style="color: #374151;">Your certificate is attached to this email as a PDF. Well done on this achievement — we wish you continued success!</p>
        </div>
        <p style="color: #9ca3af; font-size: 12px; text-align: center; margin-top: 16px;">
          Questions? Contact us at <a href="mailto:${process.env.ADMIN_EMAIL}" style="color: #4f46e5;">${process.env.ADMIN_EMAIL}</a>
        </p>
      </div>
    `,
    attachments: [
      {
        filename: `Fillip-Certificate-${certificateNo}.pdf`,
        content: pdfBuffer,
        contentType: "application/pdf",
      },
    ],
  });
};

// ─── Direct admin email (free-form, with optional attachments) ────────────
// Admin composes a one-off message to any recipient(s). `attachments` is a
// nodemailer attachments array (e.g. [{ filename, path }]).
export const sendDirectMail = async ({ to, subject, message, attachments = [] }) => {
  const body = String(message).replace(/\n/g, "<br>");

  await transporter.sendMail({
    from: `"Fillip Skill Academy" <${process.env.SMTP_USER}>`,
    to,
    subject,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f9fafb; padding: 24px; border-radius: 12px;">
        <div style="background: #1e3a8a; color: white; padding: 20px; border-radius: 8px; text-align: center; margin-bottom: 20px;">
          <h1 style="margin: 0; font-size: 20px;">Fillip Skill Academy</h1>
        </div>
        <div style="background: white; padding: 24px; border-radius: 8px; border: 1px solid #e5e7eb;">
          <div style="color: #374151; line-height: 1.6;">${body}</div>
        </div>
        <p style="color: #9ca3af; font-size: 12px; text-align: center; margin-top: 16px;">
          Fillip Skill Academy${process.env.ADMIN_EMAIL ? ` · <a href="mailto:${process.env.ADMIN_EMAIL}" style="color:#2563eb;">${process.env.ADMIN_EMAIL}</a>` : ""}
        </p>
      </div>
    `,
    attachments,
  });
};

// ─── Reply mail from admin to user ────────────────────────
export const sendReplyMail = async ({ name, email, ticketId, subject, replyMessage }) => {
  try {
    await transporter.sendMail({
      from: `"Fillip Skill Academy Support" <${process.env.SMTP_USER}>`,
      to: email,
      subject: `Re: [${ticketId}] ${subject}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #2563eb;">Hi ${name}!</h2>
          <p>Our team has responded to your enquiry <strong>${ticketId}</strong>.</p>
          <hr style="border: none; border-top: 1px solid #e5e7eb;" />
          <p><strong>Response from our team:</strong></p>
          <blockquote style="border-left: 4px solid #2563eb; padding-left: 12px; color: #374151;">
            ${replyMessage}
          </blockquote>
          <hr style="border: none; border-top: 1px solid #e5e7eb;" />
          <p style="color: #6b7280; font-size: 12px;">
            If you have further questions, reply to this email or 
            contact us at ${process.env.ADMIN_EMAIL}
          </p>
          <p style="color: #6b7280; font-size: 12px;">Fillip Skill Academy Team</p>
        </div>
      `,
    });
  } catch (error) {
    throw new ApiError(500, `Failed to send reply email: ${error.message}`);
  }
};