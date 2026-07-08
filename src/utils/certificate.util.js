import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import puppeteer from "puppeteer";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = path.join(__dirname, "../assets");

// Read an asset as a data: URI so the HTML is fully self-contained (Puppeteer
// needs no file/network access). Returns null when the file isn't present.
const asDataUri = (file) => {
  const p = path.join(ASSETS_DIR, file);
  if (!fs.existsSync(p)) return null;
  const ext = path.extname(file).slice(1).toLowerCase();
  const mime = ext === "svg" ? "image/svg+xml" : `image/${ext === "jpg" ? "jpeg" : ext}`;
  return `data:${mime};base64,${fs.readFileSync(p).toString("base64")}`;
};

// Signature font (Alex Brush) embedded once so auto-generated signatures render
// identically on any machine, headless, without a network fetch.
const SIGNATURE_FONT_PATH = path.join(ASSETS_DIR, "fonts/signature.ttf");
const SIGNATURE_FONT_B64 = fs.existsSync(SIGNATURE_FONT_PATH)
  ? fs.readFileSync(SIGNATURE_FONT_PATH).toString("base64")
  : null;

// Escape values interpolated into the HTML so names/courses with & < > " stay safe.
const esc = (s = "") =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const fmtDate = (d) =>
  new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });

// "2nd June 2025" — ordinal day, used for the internship duration range.
const fmtDateOrdinal = (d) => {
  const dt = new Date(d);
  const day = dt.getDate();
  const suffix = day % 10 === 1 && day !== 11 ? "st"
    : day % 10 === 2 && day !== 12 ? "nd"
    : day % 10 === 3 && day !== 13 ? "rd" : "th";
  const rest = dt.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
  return `${day}${suffix} ${rest}`;
};

// Per-type branding. Course certificates are issued in the name of Fillip Skill
// Academy; internship certificates in the name of Fillip Technologies.
const BRAND = {
  completion: { org: "Fillip Skill Academy", logoFile: "fsa-logo.png", logoHeight: 66, title: "CERTIFICATE OF COMPLETION" },
  internship: { org: "Fillip Technologies", logoFile: "fillip-logo.png", logoHeight: 62, title: "CERTIFICATE OF INTERNSHIP" },
};

// Default signatories. The left block's role is a selectable designation; the
// right block's role is always "Trainer". Signatures are auto-drawn from the
// names in the signature font. Pass `signatories` to override.
const defaultSignatories = () => ({
  left: { name: "Enter name", role: "IT Team Lead" },
  right: { name: "Enter name", role: "Trainer" },
});

// ── Shared headless browser ──────────────────────────────────────────────────
// Launching Chromium is expensive (~1s), so keep ONE instance alive and reuse it
// across certificates — important for bulk issuance. Relaunches if it ever drops.
let browserPromise = null;
const getBrowser = async () => {
  if (browserPromise) {
    try {
      const b = await browserPromise;
      if (b.connected) return b;
    } catch {
      /* fall through and relaunch */
    }
  }
  browserPromise = puppeteer.launch({
    headless: true,
    // The extra flags disable Chrome's crash-reporter / GPU helper processes,
    // which are what briefly flash a black console window on Windows.
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-gpu",
      "--disable-crash-reporter",
      "--disable-breakpad",
      "--no-first-run",
      "--disable-dev-shm-usage",
    ],
  });
  return browserPromise;
};

// ── HTML template ────────────────────────────────────────────────────────────
export const buildCertificateHtml = ({
  studentName,
  courseName,
  certificateNo,
  issuedAt,
  type = "completion", 
  title,
  organization,
  signatories,
  fromDate,
  toDate, 
  department, 
}) => {
  const isInternship = type === "internship";
  const brand = isInternship ? BRAND.internship : BRAND.completion;
  const org = organization || brand.org;
  const heading = title || brand.title;
  const sigs = signatories || defaultSignatories();

  const logo = asDataUri(brand.logoFile);
  const watermark = asDataUri("fillip-logo-icon.png");

  // Internship: show the duration as "from <start> to <end>" when both dates are
  // given; otherwise fall back to the single issue date.
  const period = fromDate && toDate
    ? `held from ${esc(fmtDateOrdinal(fromDate))} to ${esc(fmtDateOrdinal(toDate))}`
    : `on ${esc(fmtDate(issuedAt))}`;

  const dept = (department || "").trim();
  let body;
  if (isInternship && dept) {
    // Department-based wording, e.g. "…in HR Department as a HR Intern in Fillip
    // Technologies Private Limited, Patna, held from … to …".
    body = `has successfully completed an internship in <b>${esc(dept)} Department</b>
       as a <b>${esc(courseName)} Intern</b> in <b>Fillip Technologies Private Limited</b>,
       Patna, ${period}.`;
  } else if (isInternship) {
    body = `has successfully completed an internship in <b>${esc(courseName)}</b> at
       <b>${esc(org)}</b>, Patna, ${period}.`;
  } else {
    body = `has successfully completed the <b>${esc(courseName)}</b> course conducted by
       <b>${esc(org)}</b>, Patna, on ${esc(fmtDate(issuedAt))}.`;
  }

  // A signature block: an auto-generated script signature (the name in the
  // signature font), a rule, then the printed name + role/designation.
  const sigBlock = ({ name, role }) => `
    <div class="sig">
      <div class="sig-script">${esc(name)}</div>
      <div class="sig-line"></div>
      <div class="sig-name">${esc(name)}</div>
      <div class="sig-role">${esc(role)}</div>
    </div>`;

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Certificate</title>
<style>
  ${SIGNATURE_FONT_B64 ? `@font-face { font-family: 'SignatureFont'; src: url(data:font/ttf;base64,${SIGNATURE_FONT_B64}) format('truetype'); font-weight: normal; font-style: normal; }` : ""}
  * { box-sizing: border-box; }
  body { margin: 0; background: #ffffff;
    font-family: system-ui, -apple-system, 'Segoe UI', Roboto, Ubuntu, 'Helvetica Neue', Arial, sans-serif; }
  .wrapper { width: 1123px; height: 794px; display: flex; justify-content: center; align-items: center; }
  .certificate { width: 1123px; height: 794px; padding: 44px 70px 56px; position: relative; overflow: hidden; background: #ffffff; }

  .watermark {
    position: absolute; top: 52%; left: 50%; transform: translate(-50%, -50%);
    width: 520px; opacity: 0.03; pointer-events: none; user-select: none;
  }
  .content { position: relative; z-index: 1; height: 100%; }

  .cert-no { font-size: 15px; color: #333; }
  .logo { margin-top: 18px; }
  .logo img { height: 62px; }
  .logo-fallback { font-size: 26px; font-weight: 800; color: #1f4e9b; }

  .title { text-align: center; font-size: 44px; font-weight: 800; letter-spacing: 1px; color: #1b2a4a; margin: 26px 0 0; }
  .subtitle { text-align: center; font-size: 20px; letter-spacing: 3px; color: #555; margin: 24px 0 0; }
  .name { text-align: center; font-size: 56px; font-weight: 800; color: #1f4e9b; letter-spacing: 1px; text-transform: uppercase; margin: 16px 0 0; }

  .description { text-align: center; font-size: 23px; line-height: 37px; color: #1b2a4a; max-width: 1000px; margin: 26px auto 0; }
  .description b { font-weight: 800; }

  .bottom {
    position: absolute; bottom: 40px; left: 70px; right: 70px;
    display: flex; align-items: flex-end; justify-content: space-between; gap: 30px;
  }
  .sig { width: 340px; text-align: center; }
  .sig-script { height: 58px; line-height: 58px; font-size: 40px; color: #14213d;
    font-family: 'SignatureFont', 'Segoe Script', 'Brush Script MT', cursive;
    white-space: nowrap; overflow: hidden; }
  .sig-line { height: 2px; background: #111; width: 100%; }
  .sig-name { font-size: 18px; font-weight: 700; color: #1b2a4a; margin-top: 8px; }
  .sig-role { font-size: 14px; color: #444; margin-top: 2px; }

  /* Gold medal with ribbon tails (pure CSS — no image needed) */
  .medal-wrap { position: relative; width: 150px; height: 190px; flex: none; }
  .ribbon { position: absolute; top: 96px; width: 34px; height: 88px; z-index: 1;
    background: linear-gradient(#f6cf4e, #b8860b);
    clip-path: polygon(0 0, 100% 0, 100% 100%, 50% 76%, 0 100%); }
  .ribbon.left { left: 46px; transform: rotate(10deg); }
  .ribbon.right { right: 46px; transform: rotate(-10deg); }
  .medal { position: absolute; top: 6px; left: 10px; width: 130px; height: 130px; border-radius: 50%; z-index: 2;
    background:
      conic-gradient(#8a6d0b, #ffe789, #8a6d0b, #ffe789, #8a6d0b, #ffe789, #8a6d0b, #ffe789, #8a6d0b, #ffe789, #8a6d0b, #ffe789, #8a6d0b);
    box-shadow: inset 0 0 0 6px #d4af37, 0 5px 12px rgba(0,0,0,.28); }
  .medal::after { content: ''; position: absolute; inset: 24px; border-radius: 50%;
    background: radial-gradient(circle at 40% 34%, #ffedb0, #cf9d24 72%);
    box-shadow: inset 0 0 0 2px rgba(255,255,255,.45), inset 0 0 10px rgba(120,90,10,.5); }
</style>
</head>
<body>
  <div class="wrapper">
    <div class="certificate">
      ${watermark ? `<img src="${watermark}" class="watermark" alt="">` : ""}

      <div class="content">
        <div class="cert-no">Certificate No : ${esc(certificateNo)}</div>

        <div class="logo">
          ${logo ? `<img src="${logo}" style="height:${brand.logoHeight}px" alt="${esc(org)}">` : `<div class="logo-fallback">${esc(org)}</div>`}
        </div>

        <div class="title">${esc(heading)}</div>
        <div class="subtitle">THIS CERTIFIES THAT</div>
        <div class="name">${esc(studentName)}</div>

        <div class="description">${body}</div>

        <div class="bottom">
          ${sigBlock(sigs.left)}
          <div class="medal-wrap">
            <span class="ribbon left"></span>
            <span class="ribbon right"></span>
            <span class="medal"></span>
          </div>
          ${sigBlock(sigs.right)}
        </div>
      </div>
    </div>
  </div>
</body>
</html>`;
};

// ─────────────────────────────────────────────────────────────────────────────
// Render a Certificate as a PDF and resolve with a Buffer.
//   { studentName, courseName, certificateNo, issuedAt, title?, organization?, signatories? }
// Rendered from HTML/CSS via headless Chromium (Puppeteer).
// ─────────────────────────────────────────────────────────────────────────────
export const generateCertificatePDF = async ({
  studentName,
  courseName,
  certificateNo,
  issuedAt = new Date(),
  type,
  title,
  organization,
  signatories,
  fromDate,
  toDate,
  department,
}) => {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    const html = buildCertificateHtml({
      studentName,
      courseName,
      certificateNo,
      issuedAt,
      type,
      title,
      organization,
      signatories,
      fromDate,
      toDate,
      department,
    });
    await page.setContent(html, { waitUntil: "networkidle0" });
    const pdf = await page.pdf({
      width: "1123px",
      height: "794px",
      printBackground: true,
      pageRanges: "1",
    });
    return Buffer.from(pdf);
  } finally {
    await page.close();
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Format a certificate number from a global sequence value + the issue date:
//   FTCTF-<YYMMDD>-<AA00>-5C<N>
//   • YYMMDD  — issue date (year last-2, month, day)
//   • AA00    — two CAPITAL letters + two digits, advancing with the sequence
//   • 5C<N>   — literal "5C" + a number that starts at 3 and keeps rising (3–100000)
// `seq` comes from an atomic Counter (see nextCertSeq), so every part is
// monotonic, never reused when certificates are deleted, and collision-free.
// ─────────────────────────────────────────────────────────────────────────────
export const buildCertificateNo = (seq, date = new Date()) => {
  const d = new Date(date);
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");

  const m = Math.max(0, Number(seq) - 1); // 0-based position in the sequence
  const digits = String(m % 100).padStart(2, "0");                 // 00–99
  const li = Math.floor(m / 100) % 676;                            // 0–675 → AA–ZZ
  const alpha = String.fromCharCode(65 + Math.floor(li / 26)) +
                String.fromCharCode(65 + (li % 26)) + digits;
  const num = 3 + (m % 99998);                                     // 3–100000, rising

  return `FTCTF-${yy}${mm}${dd}-${alpha}-5C${num}`;
};
