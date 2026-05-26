const path = require("path");
const fs = require("fs");

const EMAIL_LOGO_CID = "formbridge-email-logo";
/** Email-only asset (white mark). Do not use sidebar/frontend logo paths. */
const LOGO_FILENAME = "formbridge-email-logo.png";
const LOGO_PLACEHOLDER = "<!--FORMBRIDGE_EMAIL_LOGO-->";

const EMAIL_LOGO_PATH = path.join(__dirname, "..", "assets", "brand", LOGO_FILENAME);

function resolveLogoPath() {
  if (fs.existsSync(EMAIL_LOGO_PATH)) return EMAIL_LOGO_PATH;
  return EMAIL_LOGO_PATH;
}

function escapeHtml(s) {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getEmailLogoPublicUrl() {
  const envUrl = String(process.env.EMAIL_LOGO_URL || "").trim();
  if (envUrl) return envUrl;

  const base = String(
    process.env.PUBLIC_BASE_URL || process.env.FRONTEND_URL || "https://app.formbridge.ai"
  )
    .trim()
    .replace(/\/+$/, "");

  const host = /csformly\.concatstring\.com/i.test(base)
    ? "https://app.formbridge.ai"
    : base;

  return `${host}/brand/${LOGO_FILENAME}`;
}

/** White logo on dark email header (no extra white box). */
function buildEmailLogoHtml(cid, { alt = "formbridge", width = 200 } = {}) {
  const src = cid ? `cid:${EMAIL_LOGO_CID}` : getEmailLogoPublicUrl();
  return `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" width="${width}" style="display:block;margin:0 auto 10px;border:0;outline:none;height:auto;max-width:100%;" />`;
}

function attachEmailLogo(attachments = []) {
  const list = Array.isArray(attachments) ? [...attachments] : [];

  if (list.some((a) => a && a.cid === EMAIL_LOGO_CID)) {
    return { cid: EMAIL_LOGO_CID, attachments: list };
  }

  const logoPath = resolveLogoPath();
  if (!fs.existsSync(logoPath)) {
    console.warn(`[email] Email logo not found at ${logoPath}`);
    return { cid: null, attachments: list };
  }

  list.push({
    filename: LOGO_FILENAME,
    path: logoPath,
    cid: EMAIL_LOGO_CID,
    contentDisposition: "inline",
  });

  return { cid: EMAIL_LOGO_CID, attachments: list };
}

function injectEmailLogoIntoHtml(html, logoHtml) {
  if (!html || typeof html !== "string" || !logoHtml) return html;
  let out = html;

  if (out.includes(LOGO_PLACEHOLDER)) {
    out = out.split(LOGO_PLACEHOLDER).join(logoHtml);
  }

  out = out.replace(/\{\{EmailLogo\}\}/gi, logoHtml);
  out = out.replace(/\{EmailLogo\}/g, logoHtml);

  out = out.replace(/<div class="logo"[^>]*>[\s\S]*?<\/div>/gi, logoHtml);

  out = out.replace(
    /<div[^>]*>\s*formbridge\s*<span[^>]*>\s*\.ai\s*<\/span>\s*<\/div>/gi,
    logoHtml
  );

  return out;
}

function prepareBrandedEmail(html, attachments = []) {
  const { cid, attachments: withLogo } = attachEmailLogo(attachments);
  const logoHtml = buildEmailLogoHtml(cid);
  const brandedHtml = injectEmailLogoIntoHtml(html, logoHtml);
  return { html: brandedHtml, attachments: withLogo, logoHtml, logoCid: cid };
}

module.exports = {
  EMAIL_LOGO_CID,
  EMAIL_LOGO_PATH,
  LOGO_PLACEHOLDER,
  resolveLogoPath,
  getEmailLogoPublicUrl,
  buildEmailLogoHtml,
  attachEmailLogo,
  injectEmailLogoIntoHtml,
  prepareBrandedEmail,
};
