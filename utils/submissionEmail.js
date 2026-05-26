const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const EMAIL_BRAND_NAME = "formbridge.ai";

function escapeHtml(s) {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function valueToText(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    // If it's an object, try to stringify it nicely
    if (typeof value === "object") {
      return JSON.stringify(value, null, 2);
    }
    return String(value);
  } catch (_) {
    try {
      // Fallback for objects that might have circular references
      return Object.entries(value)
        .map(([k, v]) => `${k}: ${typeof v === "object" ? "[Object]" : v}`)
        .join(", ");
    } catch (__) {
      return "[Complex Object]";
    }
  }
}

function renderDisplayValue(value, { key = "", linkClass = "", linkStyle = "" } = {}) {
  const lowerKey = String(key || "").toLowerCase();
  const isSocialOrWeb = lowerKey.includes("linkedin") || lowerKey.includes("github") || lowerKey.includes("website") || lowerKey.includes("portfolio") || lowerKey.includes("link");
  const isResume = lowerKey.includes("resume") || lowerKey.includes("cv");

  const getLabel = (url) => {
    if (isSocialOrWeb) return url;
    if (isResume) return "Download";
    return "View Attachment";
  };

  const getStyle = (baseStyle) => {
    let style = baseStyle || "";
    if (isSocialOrWeb) {
      if (style && !style.includes("font-weight")) {
        style += " font-weight: 400;";
      } else if (!style) {
        style = "font-weight: 400;";
      } else {
        style = style.replace(/font-weight:\s*600/g, "font-weight: 400");
      }
    }
    return style;
  };

  if (Array.isArray(value)) {
    return value
      .map((v) => {
        if (typeof v === "string" && v.startsWith("http")) {
          const style = getStyle(linkStyle);
          const attrs = linkClass
            ? ` class="${linkClass}"${style ? ` style="${style}"` : ""}`
            : style
              ? ` style="${style}"`
              : "";
          return `<a href="${escapeHtml(v)}"${attrs}>${escapeHtml(getLabel(v))}</a>`;
        }
        return escapeHtml(valueToText(v));
      })
      .join(", ");
  }

  if (typeof value === "string" && value.startsWith("http")) {
    const style = getStyle(linkStyle);
    const attrs = linkClass
      ? ` class="${linkClass}"${style ? ` style="${style}"` : ""}`
      : style
        ? ` style="${style}"`
        : "";
    return `<a href="${escapeHtml(value)}"${attrs}>${escapeHtml(getLabel(value))}</a>`;
  }

  return escapeHtml(valueToText(value));
}

function parseJsonIfPossible(value) {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return value;
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    try {
      return JSON.parse(trimmed);
    } catch (_) {
      return value;
    }
  }
  return value;
}

function normalizeCleanDataForEmail(cleanData) {
  if (!cleanData || typeof cleanData !== "object" || Array.isArray(cleanData)) {
    return cleanData || {};
  }

  const source = { ...cleanData };

  // Helper to find key case-insensitively
  const findKey = (obj, target) => {
    return Object.keys(obj).find(
      (k) => String(k).trim().toLowerCase() === target.toLowerCase()
    );
  };

  // We want to flatten "payload" and "data" keys if they contain objects
  const keysToFlatten = ["payload", "data"];
  let changed = true;
  let iterations = 0;

  while (changed && iterations < 3) {
    changed = false;
    iterations++;

    for (const targetKey of keysToFlatten) {
      const actualKey = findKey(source, targetKey);
      if (actualKey) {
        const rawVal = source[actualKey];
        const parsed = parseJsonIfPossible(rawVal);

        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          // It's a valid object to flatten
          delete source[actualKey];
          changed = true;

          for (const [k, v] of Object.entries(parsed)) {
            // Only overwrite if current value is empty or undefined
            if (source[k] === undefined || source[k] === "") {
              source[k] = v;
            }
          }
        }
      }
    }
  }

  // Filter out internal fields we don't want to show in emails
  const keysToIgnore = ["cf-turnstile-response", "g-recaptcha-response", "_gotcha"];
  for (const key of Object.keys(source)) {
    if (keysToIgnore.some(k => k.toLowerCase() === key.toLowerCase())) {
      delete source[key];
    }
  }

  return source;
}

/** Turn "NAME-2" / "enquiryType-2" into "Name 2" / "Enquiry Type 2" for email labels. */
function formatFieldLabelForEmail(key) {
  const raw = String(key || "").trim();
  if (!raw) return "";
  return raw
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => {
      const s = part.trim();
      if (!s) return "";
      if (/^\d+$/.test(s)) return s;
      const lower = s.toLowerCase();
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

const EMAIL_FONT_STACK = "'Work Sans',system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const EMAIL_FONT_IMPORT =
  "@import url('https://fonts.googleapis.com/css2?family=Work+Sans:wght@400;600;700&display=swap');";
const BRAND_PRIMARY = "#184BFB";
const BRAND_DARK = "#0e1116";
const BRAND_CREAM = "#f3f2ec";

/** Two-column row: label left | value right (single table, no nested blocks). */
function buildEmailFieldRow(key, value, { linkStyle = "", linkClass = "file-link" } = {}) {
  const displayValue = renderDisplayValue(value, { key, linkStyle, linkClass });
  const label = formatFieldLabelForEmail(key);
  return `
    <tr>
      <td width="150" align="left" valign="top" style="width:150px;min-width:150px;max-width:150px;text-align:left !important;vertical-align:top;padding:10px 16px 10px 0;border-bottom:1px solid #eef2f7;color:#6b7280;font-size:11px;font-weight:700;letter-spacing:0.3px;font-family:${EMAIL_FONT_STACK};mso-line-height-rule:exactly;">
        ${escapeHtml(label)}
      </td>
      <td align="left" valign="top" style="text-align:left !important;vertical-align:top;padding:10px 0;border-bottom:1px solid #eef2f7;color:#111827;font-size:14px;font-weight:400;font-family:${EMAIL_FONT_STACK};word-break:break-word;mso-line-height-rule:exactly;">
        ${displayValue}
      </td>
    </tr>`;
}

function buildEmailFieldsTableHtml(data, options = {}) {
  const rows = Object.entries(data || {})
    .map(([key, value]) => buildEmailFieldRow(key, value, options))
    .join("");
  return `<table class="submission-fields-table" role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" align="left" style="width:100%;border-collapse:collapse;mso-table-lspace:0;mso-table-rspace:0;">${rows}</table>`;
}

/** Fix legacy/custom Quill tables: Gmail centers <th> and breaks label alignment. */
function normalizeFieldTablesInEmailHtml(html) {
  if (!html || typeof html !== "string") return html;

  let out = html;

  out = out.replace(/<table(\s[^>]*)?>/gi, (match, attrs = "") => {
    let a = String(attrs);
    if (/style\s*=/i.test(a)) {
      a = a.replace(/text-align:\s*center/gi, "text-align:left");
    } else {
      a += ' style="text-align:left !important;"';
    }
    if (!/align\s*=/i.test(a)) a = ` align="left"${a}`;
    return `<table${a}>`;
  });

  const labelTdStyle =
    "width:150px;min-width:150px;max-width:150px;text-align:left !important;vertical-align:top;font-weight:700;color:#6b7280;font-size:11px;padding:10px 16px 10px 0;border-bottom:1px solid #eef2f7;mso-line-height-rule:exactly;";

  out = out.replace(/<th(\s[^>]*)?>/gi, (match, attrs = "") => {
    let a = String(attrs)
      .replace(/text-align:\s*[^;"]+/gi, "")
      .replace(/text-transform:\s*uppercase/gi, "");
    const styleMatch = a.match(/style\s*=\s*"([^"]*)"/i);
    if (styleMatch) {
      const merged = `${styleMatch[1]};${labelTdStyle}`.replace(/;;+/g, ";");
      a = a.replace(/style\s*=\s*"[^"]*"/i, `style="${merged}"`);
    } else {
      a += ` style="${labelTdStyle}"`;
    }
    return `<td align="left" valign="top"${a}>`;
  });
  out = out.replace(/<\/th>/gi, "</td>");

  return out;
}

function looksLikeFileUrl(url) {
  if (typeof url !== "string") return false;
  const lower = url.toLowerCase();
  if (!/^https?:\/\//.test(lower)) return false;
  return (
    /(\.pdf|\.doc|\.docx|\.xls|\.xlsx|\.ppt|\.pptx|\.txt|\.zip|\.rar|\.jpg|\.jpeg|\.png|\.webp)(\?|#|$)/.test(lower) ||
    lower.includes(".digitaloceanspaces.com/forms/") ||
    lower.includes("/uploads/")
  );
}

function fileNameFromUrl(url, fallback = "attachment") {
  try {
    const u = new URL(url);
    const raw = (u.pathname.split("/").pop() || fallback).trim();
    return raw || fallback;
  } catch (_) {
    return fallback;
  }
}

function collectUrlBackedAttachments(cleanData, alreadyAttached = []) {
  const out = [];
  const seen = new Set();

  // Seed seen with any URLs already present in direct attachments
  for (const att of alreadyAttached) {
    if (att.url) seen.add(String(att.url).trim());
  }

  for (const [key, value] of Object.entries(cleanData || {})) {
    const values = Array.isArray(value) ? value : [value];
    for (const v of values) {
      if (typeof v !== "string") continue;
      if (!looksLikeFileUrl(v)) continue;
      if (seen.has(v)) continue;
      seen.add(v);

      const item = {
        filename: fileNameFromUrl(v, `${key || "attachment"}`),
        path: v,
      };

      // Optimization: if it's a local /uploads/ URL, use the direct file path
      // instead of making nodemailer fetch it via HTTP (which might 404)
      if (v.includes("/uploads/")) {
        try {
          let fileName = v.split("/").pop();
          fileName = fileName.split("?")[0].split("#")[0];
          const localPath = path.join(__dirname, "..", "local-storage", fileName);
          if (fs.existsSync(localPath)) {
            item.path = localPath;
          }
        } catch (err) {
          console.error("Error resolving local path for attachment:", err);
        }
      }

      out.push(item);
    }
  }

  return out;
}

function parseNotificationEmails(raw) {
  if (!raw || typeof raw !== "string") return [];
  const parsed = raw
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s));

  // Deduplicate emails
  return [...new Set(parsed)];
}

function processCidImages(html, attachments) {
  let updatedHtml = html;
  const imgRegex = /<img[^>]+src="([^">]+)"/g;
  let match;

  while ((match = imgRegex.exec(html)) !== null) {
    const fullSrc = match[1];
    console.log("Found image src:", fullSrc);
    // Only process local /uploads URLs
    if (fullSrc.includes("/uploads/")) {
      try {
        let fileName = fullSrc.split("/").pop();
        // Clean fileName (remove query params or hashes if any)
        fileName = fileName.split("?")[0].split("#")[0];

        const filePath = path.join(__dirname, "..", "local-storage", fileName);

        console.log("Attempting to embed file:", filePath);
        if (fs.existsSync(filePath)) {
          const cid = crypto.randomBytes(16).toString("hex");
          const content = fs.readFileSync(filePath);

          attachments.push({
            filename: fileName,
            content: content,
            cid: cid
          });

          updatedHtml = updatedHtml.replace(fullSrc, `cid:${cid}`);
          console.log("Successfully embedded image with CID:", cid);
        } else {
          console.error("File does not exist for embedding:", filePath);
        }
      } catch (err) {
        console.error("Error embedding CID image:", err);
      }
    }
  }
  return updatedHtml;
}

function buildSubmissionEmailHtml({ formName, formId, dashboardUrl, cleanData, metadata = {} }) {
  const { submittedAt, ipAddress } = metadata;
  const normalizedData = normalizeCleanDataForEmail(cleanData);
  const fieldsTable = buildEmailFieldsTableHtml(normalizedData, { linkClass: "file-link" });

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    ${EMAIL_FONT_IMPORT}
    body { font-family: ${EMAIL_FONT_STACK}; background-color: ${BRAND_CREAM}; margin: 0; padding: 20px 0; color: #111827; }
    .container { max-width: 640px; margin: 0 auto; background-color: #ffffff; border-radius: 14px; overflow: hidden; border: 1px solid #e5e7eb; }
    .header { background: linear-gradient(135deg, ${BRAND_PRIMARY} 0%, ${BRAND_DARK} 100%); padding: 34px 24px 28px; text-align: center; color: white; }
    .logo { font-size: 32px; font-weight: 800; letter-spacing: -0.6px; margin-bottom: 8px; color: #ffffff; }
    .logo span { color: rgba(255,255,255,0.78); font-weight: 500; }
    .title { font-size: 12px; font-weight: 600; letter-spacing: 2.5px; opacity: 0.95; text-transform: uppercase; }
    .content { padding: 24px; }
    .card { border: 1px solid #e5e7eb; border-radius: 10px; overflow: hidden; margin-bottom: 16px; }
    .card-inner { padding: 14px 16px; }
    .card-title { margin: 0 0 6px; font-size: 18px; font-weight: 700; color: #111827; }
    .card-link { font-size: 12px; color: #184BFB; text-decoration: none; word-break: break-all; }
    .submission-fields-table { width: 100%; border-collapse: collapse; }
    .submission-fields-table td { text-align: left !important; vertical-align: top; }
    .submission-fields-table tr:last-child td { border-bottom: 0; }
    .meta-section { margin-top: 6px; border-top: 1px dashed #e5e7eb; padding-top: 10px; }
    .meta-row { display: table; width: 100%; font-size: 12px; color: #6b7280; margin: 6px 0; }
    .meta-label, .meta-value { display: table-cell; }
    .meta-label { font-weight: 700; }
    .meta-value { color: #111827; text-align: right; }
    .footer { background-color: #f8fafc; padding: 16px; text-align: center; font-size: 12px; color: #94a3b8; border-top: 1px solid #eef2f7; }
    .btn { display: inline-block; padding: 12px 20px; background-color: #184BFB; color: #ffffff !important; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 14px; }
    .btn-container { text-align: center; padding-top: 14px; }
    .file-link { color: #184BFB; text-decoration: none; font-weight: 400; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo">${escapeHtml(EMAIL_BRAND_NAME)}</div>
      <div class="title">New Submission</div>
    </div>
    <div class="content">
      <div class="card">
        <div class="card-inner">
          <h2 class="card-title">${escapeHtml(formName || formId)}</h2>
          <a href="${escapeHtml(dashboardUrl)}" class="card-link">${escapeHtml(dashboardUrl)}</a>
        </div>
      </div>

      <div class="card">
        <div class="card-inner">
          ${fieldsTable}
        </div>
      </div>

      <div class="meta-section">
        <div class="meta-row">
          <span class="meta-label">Submitted At</span>
          <span class="meta-value">${escapeHtml(submittedAt || new Date().toLocaleString())}</span>
        </div>
        <div class="meta-row">
          <span class="meta-label">IP Address</span>
          <span class="meta-value">${escapeHtml(ipAddress || "Unknown")}</span>
        </div>
      </div>

      <div class="btn-container">
        <a href="${escapeHtml(dashboardUrl)}" class="btn">Go to Dashboard</a>
      </div>
    </div>
    <div class="footer">
      This notification was sent via <strong>${escapeHtml(EMAIL_BRAND_NAME)}</strong>.
    </div>
  </div>
</body>
</html>`;
}

const { sanitizeDashboardUrl } = require("./dashboardUrl");

async function sendSubmissionNotificationEmails({
  transporter,
  fromUser,
  fromName,
  formName,
  formId,
  dashboardUrl: rawDashboardUrl,
  cleanData,
  recipients = [],
  metadata = {},
  customTemplateEnabled,
  customTemplateBody,
  attachments = [],
  ccRecipients = [],
}) {
  const normalizedData = normalizeCleanDataForEmail(cleanData);
  const subject = `New Submission - ${formName || formId} | ${EMAIL_BRAND_NAME}`;
  const senderName = fromName || EMAIL_BRAND_NAME;

  if (recipients.length === 0 && ccRecipients.length === 0) {
    console.warn(`No notification recipients defined for form ${formId}. Skipping email notification.`);
    return;
  }

  if (!fromUser) {
    console.warn(`No sender email defined for form ${formId}. Skipping email notification.`);
    return;
  }

  const { applyCustomTemplatePlaceholders } = require("./emailTemplate");

  const dashboardUrl = sanitizeDashboardUrl(
    rawDashboardUrl,
    {
      headers: {
        origin: metadata.requestOrigin || "",
        referer: metadata.requestReferer || "",
      },
      ip: metadata.ipAddress,
    }
  );

  const useCustomTemplate =
    Boolean(customTemplateEnabled) && String(customTemplateBody || "").trim().length > 0;

  // Pre-build common parts to save time
  let baseHtml;
  if (useCustomTemplate) {
    baseHtml = applyCustomTemplatePlaceholders(customTemplateBody, {
      formName,
      formId,
      dashboardUrl,
      cleanData: normalizedData,
      metadata,
    });
  } else {
    baseHtml = buildSubmissionEmailHtml({
      formName,
      formId,
      dashboardUrl,
      cleanData: normalizedData,
      metadata,
    });
  }

  const usedCustomTemplate = useCustomTemplate;

  // Process CID images
  const urlBackedAttachments = collectUrlBackedAttachments(normalizedData, attachments);
  const finalAttachments = [...attachments, ...urlBackedAttachments];
  // Unlayer/custom HTML uses nested layout tables — normalizeFieldTablesInEmailHtml
  // breaks that design (test emails skip it; submissions must match).
  const htmlForSend = usedCustomTemplate
    ? baseHtml
    : normalizeFieldTablesInEmailHtml(baseHtml);
  const finalHtml = processCidImages(htmlForSend, finalAttachments);

  const to = recipients;
  const cc = ccRecipients;

  console.log(`Sending submission email: [To: ${to.join(", ")}] [Cc: ${cc.join(", ")}] from: ${fromUser} (${senderName})`);

  try {
    await transporter.sendMail({
      from: `"${senderName}" <${fromUser}>`,
      to,
      cc,
      subject,
      attachments: finalAttachments,
      html: finalHtml,
    });
  } catch (err) {
    console.error(`Error sending email to [${to.join(", ")}]:`, err);
  }
}

function findSubmitterEmail(cleanData) {
  const emailKeys = ["email", "Email", "EMAIL", "e-mail", "E-mail"];
  for (const key of emailKeys) {
    const val = cleanData[key];
    if (typeof val === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val.trim())) {
      return val.trim();
    }
  }
  // fallback: search all fields for something that looks like an email
  for (const val of Object.values(cleanData)) {
    if (typeof val === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val.trim())) {
      return val.trim();
    }
  }
  return null;
}

function getRuleKeyFromSubmission(cleanData) {
  if (!cleanData || typeof cleanData !== "object") return "";
  const candidates = [
    "id", "Id", "ID",
    "jobid", "jobId", "JobID",
    "planId", "PlanId",
    "packageId", "PackageId"
  ];
  for (const key of candidates) {
    const value = cleanData[key];
    if (value === undefined || value === null) continue;
    const normalized = String(value).trim();
    if (normalized) return normalized;
  }
  return "";
}

function isEffectivelyEmpty(s) {
  if (!s || typeof s !== "string") return true;
  const trimmed = s.trim();
  if (!trimmed) return true;
  // If it has an image or an iframe, it's not empty
  if (/<img|<iframe/i.test(trimmed)) return false;
  // Strip all other HTML tags and check if text remains
  const stripped = trimmed.replace(/<[^>]*>/g, "").trim();
  return stripped.length === 0;
}

function normalizeAttachmentRules(rules) {
  if (!Array.isArray(rules)) return [];
  return rules
    .map((r) => ({
      key: String(r?.key || "").trim(),
      attachmentUrl: String(r?.attachmentUrl || "").trim(),
      attachmentName: String(r?.attachmentName || "").trim(),
      subject: String(r?.subject || "").trim(),
      body: String(r?.body || "").trim(),
    }))
    .filter((r) => r.key && (r.attachmentUrl || r.subject || r.body));
}

function normalizeOriginFromMetadata(metadata = {}) {
  const directOrigin = String(metadata.requestOrigin || "").trim();
  if (directOrigin) return directOrigin.replace(/\/+$/, "");

  const referer = String(metadata.requestReferer || "").trim();
  if (!referer) return "";
  try {
    return new URL(referer).origin.replace(/\/+$/, "");
  } catch (_) {
    return "";
  }
}

async function sendAutoresponderEmail({
  transporter,
  fromUser,
  fromName,
  formName,
  formId,
  cleanData,
  metadata = {},
  autoresponderSubject,
  autoresponderBody,
  attachments = [],
  staticAttachmentUrl = "",
  staticAttachmentName = "",
  attachmentRules = [],
}) {
  const to = findSubmitterEmail(cleanData);
  if (!to) {
    console.warn(`No submitter email found for form ${formId}. Skipping autoresponder.`);
    return;
  }

  const normalizedRules = normalizeAttachmentRules(attachmentRules);
  const submissionRuleKey = getRuleKeyFromSubmission(cleanData);
  let selectedRule = null;
  if (submissionRuleKey && normalizedRules.length) {
    selectedRule =
      normalizedRules.find(
        (rule) => rule.key.toLowerCase() === submissionRuleKey.toLowerCase()
      ) || null;
  }

  let html = selectedRule?.body;
  if (isEffectivelyEmpty(html)) {
    html = autoresponderBody || "Thank you for your submission!";
  }

  let subject = selectedRule?.subject;
  if (isEffectivelyEmpty(subject)) {
    subject = autoresponderSubject || `Thank you for your submission - ${formName || formId}`;
  }

  // Support an {{AllFields}} macro
  if (html.includes("{{AllFields}}") || html.includes("{AllFields}")) {
    const normalizedData = normalizeCleanDataForEmail(cleanData);
    const allFieldsTable = buildEmailFieldsTableHtml(normalizedData, {
      linkStyle: "color: #184BFB; text-decoration: none; font-weight: 400;",
      linkClass: "",
    });
    html = html.replace(/\{\{AllFields\}\}/g, allFieldsTable).replace(/\{AllFields\}/g, allFieldsTable);
  }

  // Replace placeholders in body and subject
  const normalizedData = normalizeCleanDataForEmail(cleanData);
  for (const key in normalizedData) {
    const val = normalizedData[key];
    const safeVal = escapeHtml(valueToText(val));
    html = html.replace(new RegExp(`\\{\\{${key}\\}\\}`, "gi"), safeVal);
    html = html.replace(new RegExp(`\\{${key}\\}`, "gi"), safeVal);
    subject = subject.replace(new RegExp(`\\{\\{${key}\\}\\}`, "gi"), valueToText(val));
    subject = subject.replace(new RegExp(`\\{${key}\\}`, "gi"), valueToText(val));
  }

  // Support built-in meta variables
  const metaVars = {
    FormName: formName || formId,
    SubmittedAt: metadata.submittedAt || new Date().toLocaleString(),
  };

  for (const key in metaVars) {
    html = html.replace(new RegExp(`\\{\\{${key}\\}\\}`, "gi"), metaVars[key]);
    html = html.replace(new RegExp(`\\{${key}\\}`, "gi"), metaVars[key]);
    subject = subject.replace(new RegExp(`\\{\\{${key}\\}\\}`, "gi"), metaVars[key]);
    subject = subject.replace(new RegExp(`\\{${key}\\}`, "gi"), metaVars[key]);
  }

  const senderName = fromName || EMAIL_BRAND_NAME;
  // Only configured autoresponder attachments (id-based/default) and CID embeds should be attached.
  const finalAttachments = [];

  // Add static attachment if provided (from rules or default settings)
  const effectiveAttachmentUrl = selectedRule?.attachmentUrl || staticAttachmentUrl;
  const effectiveAttachmentName = selectedRule?.attachmentName || staticAttachmentName;
  if (effectiveAttachmentUrl) {
    try {
      let fileName = effectiveAttachmentUrl.split("/").pop();
      fileName = fileName.split("?")[0].split("#")[0];
      const candidates = [
        path.join(__dirname, "..", "local-storage", fileName),
        path.join(__dirname, "..", "public", "uploads", fileName),
      ];
      const resolvedPath = candidates.find((p) => fs.existsSync(p));
      const attachmentItem = {
        filename: effectiveAttachmentName || fileName,
        path: resolvedPath || (effectiveAttachmentUrl.startsWith("http") ? effectiveAttachmentUrl : null)
      };

      if (attachmentItem.path) {
        finalAttachments.push(attachmentItem);
      } else {
        console.warn(
          `Autoresponder attachment not found for ${fileName}. URL: ${effectiveAttachmentUrl}`
        );
      }
    } catch (err) {
      console.error("Error adding static autoresponder attachment:", err);
    }
  }

  const processedHtml = processCidImages(
    normalizeFieldTablesInEmailHtml(html),
    finalAttachments
  );

  console.log(`Sending autoresponder email to: ${to} from: ${fromUser} (${senderName})`);

  await transporter.sendMail({
    from: `"${senderName}" <${fromUser}>`,
    to,
    subject,
    attachments: finalAttachments,
    html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    ${EMAIL_FONT_IMPORT}
    body { font-family: ${EMAIL_FONT_STACK}; background-color: ${BRAND_CREAM}; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 40px auto; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 20px 40px rgba(0,0,0,0.1); border: 1px solid #e1e8ed; }
    .header { background: linear-gradient(135deg, ${BRAND_PRIMARY} 0%, ${BRAND_DARK} 100%); padding: 30px 20px; text-align: center; color: white; }
    .logo { font-size: 24px; font-weight: 800; letter-spacing: -1px; color: #ffffff; }
    .logo span { color: rgba(255,255,255,0.7); font-weight: 400; }
    .content { padding: 40px; color: #334155; line-height: 1.6; font-size: 16px; }
    .footer { background-color: #f8f9fa; padding: 20px; text-align: center; font-size: 12px; color: #94a3b8; border-top: 1px solid #edf1f7; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo">${escapeHtml(EMAIL_BRAND_NAME)}</div>
    </div>
    <div class="content">
      ${processedHtml}
    </div>
    <div class="footer">
      This email was sent via <strong>${escapeHtml(EMAIL_BRAND_NAME)}</strong>.
    </div>
  </div>
</body>
</html>`,
  });
}

module.exports = {
  normalizeCleanDataForEmail,
  valueToText,
  buildEmailFieldsTableHtml,
  parseNotificationEmails,
  buildSubmissionEmailHtml,
  sendSubmissionNotificationEmails,
  sendAutoresponderEmail,
};

