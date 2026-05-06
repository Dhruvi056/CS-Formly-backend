const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

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

function renderDisplayValue(value, { linkClass = "", linkStyle = "" } = {}) {
  if (Array.isArray(value)) {
    return value
      .map((v) => {
        if (typeof v === "string" && v.startsWith("http")) {
          const attrs = linkClass
            ? ` class="${linkClass}"`
            : linkStyle
              ? ` style="${linkStyle}"`
              : "";
          return `<a href="${escapeHtml(v)}"${attrs}>View Attachment</a>`;
        }
        return escapeHtml(valueToText(v));
      })
      .join(", ");
  }

  if (typeof value === "string" && value.startsWith("http")) {
    const attrs = linkClass
      ? ` class="${linkClass}"`
      : linkStyle
        ? ` style="${linkStyle}"`
        : "";
    return `<a href="${escapeHtml(value)}"${attrs}>View Attachment</a>`;
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

  let source = { ...cleanData };

  // Helper to find key case-insensitively
  const findKey = (obj, target) => {
    return Object.keys(obj).find(
      (k) => String(k).trim().toLowerCase() === target.toLowerCase()
    );
  };

  // Internal keys to filter out from the final email view
  const internalKeys = [
    "triggerType", "name", "siteId", "submittedAt", "id", "formId",
    "formElementId", "pageId", "site_id", "form_id", "page_id"
  ];

  // We want to flatten "payload" and "data" keys if they contain objects
  const keysToFlatten = ["payload", "data"];
  let foundPrimaryData = false;

  for (const targetKey of keysToFlatten) {
    const actualKey = findKey(source, targetKey);
    if (actualKey) {
      const rawVal = source[actualKey];
      const parsed = parseJsonIfPossible(rawVal);

      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        // It's a valid object to flatten.
        // If we find "data" or "payload", it's likely the actual form content.
        delete source[actualKey];
        foundPrimaryData = true;

        for (const [k, v] of Object.entries(parsed)) {
          // Only overwrite if current value is empty or undefined
          if (source[k] === undefined || source[k] === "") {
            source[k] = v;
          }
        }
      }
    }
  }

  // If we found primary data (like from Webflow), we should be more aggressive 
  // about filtering out the outer metadata that Webflow sends.
  if (foundPrimaryData) {
    const filtered = {};
    for (const [k, v] of Object.entries(source)) {
      if (!internalKeys.some(ik => ik.toLowerCase() === k.toLowerCase())) {
        filtered[k] = v;
      }
    }
    return filtered;
  }

  return source;
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

function collectUrlBackedAttachments(cleanData) {
  const out = [];
  const seen = new Set();

  for (const [key, value] of Object.entries(cleanData || {})) {
    const values = Array.isArray(value) ? value : [value];
    for (const v of values) {
      if (typeof v !== "string") continue;
      if (!looksLikeFileUrl(v)) continue;
      if (seen.has(v)) continue;
      seen.add(v);
      out.push({
        filename: fileNameFromUrl(v, `${key || "attachment"}`),
        path: v,
      });
    }
  }

  return out;
}

function parseNotificationEmails(raw) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  const normalizeSingle = (value) => {
    if (!value) return [];

    if (typeof value === "string") {
      return value
        .split(/[,;\n]+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && emailRegex.test(s));
    }

    if (Array.isArray(value)) {
      return value.flatMap((item) => normalizeSingle(item));
    }

    if (typeof value === "object") {
      // UI can send recipients as objects like { email }, { value }, etc.
      return normalizeSingle(
        value.email || value.value || value.address || value.recipient || ""
      );
    }

    return [];
  };

  return [...new Set(normalizeSingle(raw))];
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
  const rows = Object.entries(normalizedData)
    .map(([key, value]) => {
      let displayValue;
      if (Array.isArray(value)) {
        displayValue = value
          .map((v) =>
            typeof v === "string" && v.startsWith("http")
              ? `<a href="${escapeHtml(v)}" class="file-link">View Attachment</a>`
              : escapeHtml(valueToText(v))
          )
          .join(", ");
      } else if (typeof value === "string" && value.startsWith("http")) {
        displayValue = `<a href="${escapeHtml(value)}" class="file-link">View Attachment</a>`;
      } else {
        displayValue = escapeHtml(valueToText(value));
      }
      return `
        <tr>
          <th>${escapeHtml(key)}</th>
          <td>${displayValue}</td>
        </tr>`;
    })
    .join("");

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f6f9fc; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 40px auto; background-color: #ffffff; border-radius: 4px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.05); }
    .header { background-color: #0f172a; padding: 30px 20px; text-align: center; color: white; }
    .logo { font-size: 24px; font-weight: 800; letter-spacing: -0.5px; margin-bottom: 4px; }
    .logo span { color: #ffffff; }
    .subtitle { font-size: 14px; opacity: 0.7; font-weight: 400; }
    .content { padding: 40px; }
    .form-info { background-color: #f8fafc; border-radius: 8px; padding: 24px; margin-bottom: 40px; border: 1px solid #f1f5f9; }
    .form-name { font-size: 18px; font-weight: 700; color: #0f172a; margin-bottom: 4px; }
    .form-url { font-size: 13px; color: #6366f1; text-decoration: none; word-break: break-all; opacity: 0.8; }
    .submission-data { width: 100%; border-collapse: collapse; }
    .submission-data th { text-align: left; vertical-align: top; padding: 16px 0 8px 0; color: #64748b; font-size: 11px; text-transform: uppercase; font-weight: 700; width: 30%; letter-spacing: 0.05em; }
    .submission-data td { padding: 16px 0 12px 0; border-bottom: 1px solid #f1f5f9; color: #1e293b; font-size: 14px; font-weight: 500; word-break: break-all; }
    .meta-section { margin-top: 40px; padding-top: 20px; border-top: 1px dashed #e2e8f0; }
    .meta-table { width: 100%; font-size: 12px; color: #94a3b8; }
    .meta-table td { padding: 4px 0; }
    .meta-label { font-weight: 500; width: 30%; }
    .meta-value { color: #64748b; text-align: right; }
    .footer { padding: 30px; text-align: center; font-size: 12px; color: #94a3b8; background-color: #ffffff; }
    .btn-container { text-align: center; padding-top: 40px; }
    .btn { display: inline-block; padding: 12px 24px; background-color: #6366f1; color: #ffffff !important; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 14px; box-shadow: 0 4px 6px rgba(99, 102, 241, 0.2); }
    .file-link { color: #6366f1; text-decoration: underline; font-weight: 600; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo">CS Formly</div>
      <div class="subtitle">New Submission</div>
    </div>
    <div class="content">
      <div class="form-info">
        <div class="form-name">${escapeHtml(formName || formId)}</div>
        <a href="${escapeHtml(dashboardUrl)}" class="form-url">${escapeHtml(dashboardUrl)}</a>
      </div>
      <table class="submission-data">${rows}</table>
      
      <div class="meta-section">
        <table class="meta-table">
          <tr>
            <td class="meta-label">Submitted At</td>
            <td class="meta-value">${escapeHtml(submittedAt || new Date().toLocaleString())}</td>
          </tr>
          <tr>
            <td class="meta-label">IP Address</td>
            <td class="meta-value">${escapeHtml(ipAddress || "Unknown")}</td>
          </tr>
        </table>
      </div>

      <div class="btn-container">
        <a href="${escapeHtml(dashboardUrl)}" class="btn">Go to Dashboard</a>
      </div>
    </div>
    <div class="footer">
      This notification was sent via <strong>CS Formly</strong>-the all-in-one headless form solution.
    </div>
  </div>
</body>
</html>`;
}

async function sendSubmissionNotificationEmails({
  transporter,
  fromUser,
  fromName,
  formName,
  formId,
  dashboardUrl,
  cleanData,
  recipients,
  metadata = {},
  customTemplateEnabled,
  customTemplateBody,
  attachments = [],
}) {
  if (!recipients.length) {
    console.warn(`No recipients defined for form ${formId}. Skipping email notification.`);
    return;
  }
  if (!fromUser) {
    console.warn(`No sender email defined for form ${formId}. Skipping email notification.`);
    return;
  }

  const normalizedData = normalizeCleanDataForEmail(cleanData);
  let html;
  if (customTemplateEnabled && customTemplateBody) {
    html = customTemplateBody;

    // Support an {{AllFields}} macro that dynamically dumps all form fields
    if (html.includes('{{AllFields}}') || html.includes('{AllFields}')) {
      const rowsHtml = Object.entries(normalizedData)
        .map(([key, value]) => {
          const displayValue = renderDisplayValue(value, {
            linkStyle: "color: #6571ff; text-decoration: none; font-weight: 600;",
          });
          return `
            <tr>
              <th style="text-align: left; vertical-align: top; padding: 0 15px 0 0; color: #7987a1; font-size: 12px; text-transform: uppercase; font-weight: 600; width: 35%; padding-top: 4px;">${escapeHtml(key)}</th>
              <td style="padding-bottom: 12px; border-bottom: 1px solid #edf1f7; color: #060c17; font-size: 15px; font-weight: 500; word-break: break-all;">${displayValue}</td>
            </tr>`;
        })
        .join("");

      const allFieldsTable = `<table style="width: 100%; border-collapse: separate; border-spacing: 0 12px;">${rowsHtml}</table>`;
      html = html.replace(/\{\{AllFields\}\}/g, allFieldsTable).replace(/\{AllFields\}/g, allFieldsTable);
    }

    for (const key in normalizedData) {
      const val = normalizedData[key];
      const safeVal = escapeHtml(valueToText(val));
      // support both {{key}} and {key}
      html = html.replace(new RegExp(`\\{\\{${key}\\}\\}`, "gi"), safeVal);
      html = html.replace(new RegExp(`\\{${key}\\}`, "gi"), safeVal);
    }

    // Support built-in meta variables
    const metaVars = {
      FormName: formName || formId,
      DashboardUrl: dashboardUrl,
      SubmittedAt: metadata.submittedAt || new Date().toLocaleString(),
      IpAddress: metadata.ipAddress || "Unknown"
    };

    for (const key in metaVars) {
      html = html.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'gi'), metaVars[key]);
      html = html.replace(new RegExp(`\\{${key}\\}`, 'gi'), metaVars[key]);
    }
  } else {
    html = buildSubmissionEmailHtml({
      formName,
      formId,
      dashboardUrl,
      cleanData: normalizedData,
      metadata,
    });
  }

  // Process CID images for local testing
  const urlBackedAttachments = collectUrlBackedAttachments(normalizedData);
  const finalAttachments = [...attachments, ...urlBackedAttachments];
  html = processCidImages(html, finalAttachments);

  const subject = `New Submission - ${formName || formId} | CS Formly`;

  // ... (production code omitted for brevity in this view, but keeping logic)
  const senderName = fromName || "CS Formly";

  // Log for debugging
  console.log(`Sending submission email to: ${recipients.join(", ")} from: ${fromUser} (${senderName})`);

  for (const to of recipients) {
    await transporter.sendMail({
      from: `"${senderName}" <${fromUser}>`,
      to,
      subject,
      attachments: finalAttachments,
      html,
    });
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
}) {
  const to = findSubmitterEmail(cleanData);
  if (!to) {
    console.warn(`No submitter email found for form ${formId}. Skipping autoresponder.`);
    return;
  }

  let html = autoresponderBody || "Thank you for your submission!";
  let subject = autoresponderSubject || `Thank you for your submission - ${formName || formId}`;

  // Support an {{AllFields}} macro
  if (html.includes("{{AllFields}}") || html.includes("{AllFields}")) {
    const normalizedData = normalizeCleanDataForEmail(cleanData);
    const rowsHtml = Object.entries(normalizedData)
      .map(([key, value]) => {
        const displayValue = renderDisplayValue(value, {
          linkStyle: "color: #6571ff; text-decoration: none; font-weight: 600;",
        });
        return `
          <tr>
            <th style="text-align: left; vertical-align: top; padding: 0 15px 0 0; color: #7987a1; font-size: 12px; text-transform: uppercase; font-weight: 600; width: 35%; padding-top: 4px;">${escapeHtml(key)}</th>
            <td style="padding-bottom: 12px; border-bottom: 1px solid #edf1f7; color: #060c17; font-size: 15px; font-weight: 500; word-break: break-all;">${displayValue}</td>
          </tr>`;
      })
      .join("");

    const allFieldsTable = `<table style="width: 100%; border-collapse: separate; border-spacing: 0 12px;">${rowsHtml}</table>`;
    html = html.replace(/\{\{AllFields\}\}/g, allFieldsTable).replace(/\{AllFields\}/g, allFieldsTable);
  }

  // Replace placeholders in body and subject
  const normalizedData = normalizeCleanDataForEmail(cleanData);
  for (const key in normalizedData) {
    const val = normalizedData[key];
    const safeVal = escapeHtml(valueToText(val));
    const regex = new RegExp(`\\\\{\\\\{${key}\\\\}\\\\}`, "gi");
    const regexSimple = new RegExp(`\\\\{${key}\\\\}`, "gi");
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

  const senderName = fromName || "CS Formly";

  // Process CID images for local testing
  const finalAttachments = [...attachments];

  // Add static attachment if provided
  if (staticAttachmentUrl) {
    try {
      let fileName = staticAttachmentUrl.split("/").pop();
      fileName = fileName.split("?")[0].split("#")[0];
      const filePath = path.join(__dirname, "..", "public", "uploads", fileName);

      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath);
        finalAttachments.push({
          filename: staticAttachmentName || fileName,
          content: content
        });
      }
    } catch (err) {
      console.error("Error adding static autoresponder attachment:", err);
    }
  }

  const processedHtml = processCidImages(html, finalAttachments);

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
    body { font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f0f2f5; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 40px auto; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 20px 40px rgba(0,0,0,0.1); border: 1px solid #e1e8ed; }
    .header { background: linear-gradient(135deg, #6571ff 0%, #060c17 100%); padding: 30px 20px; text-align: center; color: white; }
    .logo { font-size: 24px; font-weight: 800; letter-spacing: -1px; color: #ffffff; }
    .logo span { color: rgba(255,255,255,0.7); font-weight: 400; }
    .content { padding: 40px; color: #334155; line-height: 1.6; font-size: 16px; }
    .footer { background-color: #f8f9fa; padding: 20px; text-align: center; font-size: 12px; color: #94a3b8; border-top: 1px solid #edf1f7; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo"><span style="font-weight: 800; color: #ffffff;">CS</span>&nbsp;<span>Formly</span></div>
    </div>
    <div class="content">
      ${processedHtml}
    </div>
    <div class="footer">
      This email was sent via <strong>CS Formly</strong>.
    </div>
  </div>
</body>
</html>`,
  });
}

module.exports = {
  normalizeCleanDataForEmail,
  valueToText,
  parseNotificationEmails,
  buildSubmissionEmailHtml,
  sendSubmissionNotificationEmails,
  sendAutoresponderEmail,
};

