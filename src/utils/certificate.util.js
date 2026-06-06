import PDFDocument from "pdfkit";

// Brand palette (matches the frontend design system: blue → indigo → purple)
const COLORS = {
  navy: "#1e3a8a",
  blue: "#2563eb",
  indigo: "#4f46e5",
  purple: "#7c3aed",
  ink: "#1f2937",
  slate: "#6b7280",
  gold: "#b8860b",
};

const fmtDate = (d) =>
  new Date(d).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

// ─────────────────────────────────────────────────────────────────────────────
// Render a Certificate of Completion as a PDF and resolve with a Buffer.
//   { studentName, courseName, certificateNo, issuedAt }
// Pure pdfkit — no fonts/assets needed, works headless on any platform.
// ─────────────────────────────────────────────────────────────────────────────
export const generateCertificatePDF = ({ studentName, courseName, certificateNo, issuedAt = new Date() }) =>
  new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 0 });
      const chunks = [];
      doc.on("data", (c) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const W = doc.page.width; // 842
      const H = doc.page.height; // 595

      // Background
      doc.rect(0, 0, W, H).fill("#ffffff");

      // Decorative corner ribbons (top-left navy, bottom-right purple)
      doc.save();
      doc.moveTo(0, 0).lineTo(170, 0).lineTo(0, 170).fill(COLORS.navy);
      doc.moveTo(W, H).lineTo(W - 170, H).lineTo(W, H - 170).fill(COLORS.purple);
      doc.restore();

      // Double border frame
      doc.lineWidth(3).strokeColor(COLORS.indigo).rect(28, 28, W - 56, H - 56).stroke();
      doc.lineWidth(1).strokeColor(COLORS.gold).rect(38, 38, W - 76, H - 76).stroke();

      // ── Header ────────────────────────────────────────────────────────────
      doc
        .fillColor(COLORS.navy)
        .font("Helvetica-Bold")
        .fontSize(26)
        .text("FILLIP SKILL ACADEMY", 0, 78, { align: "center" });

      doc
        .fillColor(COLORS.slate)
        .font("Helvetica")
        .fontSize(11)
        .text("Empowering Careers Through Skills", 0, 110, { align: "center" });

      // Title
      doc
        .fillColor(COLORS.indigo)
        .font("Helvetica-Bold")
        .fontSize(34)
        .text("Certificate of Completion", 0, 150, { align: "center", characterSpacing: 1 });

      // Underline accent
      doc.moveTo(W / 2 - 130, 196).lineTo(W / 2 + 130, 196).lineWidth(2).strokeColor(COLORS.gold).stroke();

      // ── Body ──────────────────────────────────────────────────────────────
      doc
        .fillColor(COLORS.slate)
        .font("Helvetica")
        .fontSize(13)
        .text("This is to certify that", 0, 224, { align: "center" });

      doc
        .fillColor(COLORS.ink)
        .font("Helvetica-Bold")
        .fontSize(32)
        .text(studentName, 0, 250, { align: "center" });

      doc
        .fillColor(COLORS.slate)
        .font("Helvetica")
        .fontSize(13)
        .text("has successfully completed the course", 0, 300, { align: "center" });

      doc
        .fillColor(COLORS.blue)
        .font("Helvetica-Bold")
        .fontSize(22)
        .text(courseName, 60, 326, { align: "center", width: W - 120 });

      // ── Footer: certificate no, date, signature ──────────────────────────
      const baseY = H - 130;

      // Date (left)
      doc
        .fillColor(COLORS.ink)
        .font("Helvetica-Bold")
        .fontSize(12)
        .text(fmtDate(issuedAt), 90, baseY, { width: 200, align: "center" });
      doc.moveTo(90, baseY + 20).lineTo(290, baseY + 20).lineWidth(1).strokeColor(COLORS.slate).stroke();
      doc.fillColor(COLORS.slate).font("Helvetica").fontSize(10).text("Date of Issue", 90, baseY + 26, { width: 200, align: "center" });

      // Signature (right)
      doc
        .fillColor(COLORS.navy)
        .font("Helvetica-BoldOblique")
        .fontSize(16)
        .text("Fillip Skill Academy", W - 290, baseY - 4, { width: 200, align: "center" });
      doc.moveTo(W - 290, baseY + 20).lineTo(W - 90, baseY + 20).lineWidth(1).strokeColor(COLORS.slate).stroke();
      doc.fillColor(COLORS.slate).font("Helvetica").fontSize(10).text("Authorized Signatory", W - 290, baseY + 26, { width: 200, align: "center" });

      // Certificate number (centered, bottom)
      doc
        .fillColor(COLORS.slate)
        .font("Helvetica")
        .fontSize(10)
        .text(`Certificate No: ${certificateNo}`, 0, H - 64, { align: "center" });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });

// ─────────────────────────────────────────────────────────────────────────────
// Next certificate number: FSA-CERT-<YY>-<NNNN>, sequential per year.
// Reads the highest issued for the year; pair with the UNIQUE index + retry.
// ─────────────────────────────────────────────────────────────────────────────
export const buildCertificateNo = (year, seq) =>
  `FSA-CERT-${String(year).slice(-2)}-${String(seq).padStart(4, "0")}`;
