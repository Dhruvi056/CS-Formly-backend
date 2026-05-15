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

function renderDisplayValue(value, { key = "", linkClass = "", linkStyle = "" } = {}) {
  const lowerKey = String(key || "").toLowerCase();
  const isSocialOrWeb = lowerKey.includes("linkedin") || lowerKey.includes("github") || lowerKey.includes("website") || lowerKey.includes("portfolio") || lowerKey.includes("link");
  const isResume = lowerKey.includes("resume") || lowerKey.includes("cv");

  const getLabel = (url) => {
    if (isSocialOrWeb) return url;
    if (isResume) return "Download";
    return "View Attachment";
  };

  if (Array.isArray(value)) {
    return value
      .map((v) => {
        if (typeof v === "string" && v.startsWith("http")) {
          const attrs = linkClass
            ? ` class="${linkClass}"`
            : linkStyle
              ? ` style="${linkStyle}"`
              : "";
          return `<a href="${escapeHtml(v)}"${attrs}>${escapeHtml(getLabel(v))}</a>`;
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
  const rows = Object.entries(normalizedData)
    .map(([key, value]) => {
      const displayValue = renderDisplayValue(value, {
        key,
        linkClass: "file-link",
      });
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
    body { font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f3f4f8; margin: 0; padding: 20px 0; color: #111827; }
    .container { max-width: 640px; margin: 0 auto; background-color: #ffffff; border-radius: 14px; overflow: hidden; border: 1px solid #e5e7eb; }
    .header { background: linear-gradient(135deg, #6571ff 0%, #060c17 100%); padding: 34px 24px 28px; text-align: center; color: white; }
    .logo { font-size: 32px; font-weight: 800; letter-spacing: -0.6px; margin-bottom: 8px; color: #ffffff; }
    .logo span { color: rgba(255,255,255,0.78); font-weight: 500; }
    .title { font-size: 12px; font-weight: 600; letter-spacing: 2.5px; opacity: 0.95; text-transform: uppercase; }
    .content { padding: 24px; }
    .card { border: 1px solid #e5e7eb; border-radius: 10px; overflow: hidden; margin-bottom: 16px; }
    .card-inner { padding: 14px 16px; }
    .card-title { margin: 0 0 6px; font-size: 18px; font-weight: 700; color: #111827; }
    .card-link { font-size: 12px; color: #4f46e5; text-decoration: none; word-break: break-all; }
    .table { width: 100%; border-collapse: collapse; }
    .table th, .table td { padding: 10px 0; border-bottom: 1px solid #eef2f7; vertical-align: top; }
    .table tr:last-child th, .table tr:last-child td { border-bottom: 0; }
    .table th { width: 38%; color: #6b7280; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700; padding-right: 14px; }
    .table td { color: #111827; font-size: 14px; font-weight: 500; word-break: break-word; }
    .meta-section { margin-top: 6px; border-top: 1px dashed #e5e7eb; padding-top: 10px; }
    .meta-row { display: table; width: 100%; font-size: 12px; color: #6b7280; margin: 6px 0; }
    .meta-label, .meta-value { display: table-cell; }
    .meta-label { font-weight: 700; }
    .meta-value { color: #111827; text-align: right; }
    .footer { background-color: #f8fafc; padding: 16px; text-align: center; font-size: 12px; color: #94a3b8; border-top: 1px solid #eef2f7; }
    .btn { display: inline-block; padding: 12px 20px; background-color: #5b63f6; color: #ffffff !important; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 14px; }
    .btn-container { text-align: center; padding-top: 14px; }
    .file-link { color: #6571ff; text-decoration: none; font-weight: 600; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo"><span style="font-weight: 800; color: #ffffff;">CS</span>&nbsp;<span>Formly</span></div>
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
          <table class="table">${rows}</table>
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
  recipients = [],
  metadata = {},
  customTemplateEnabled,
  customTemplateBody,
  attachments = [],
  ccRecipients = [],
}) {
  const normalizedData = normalizeCleanDataForEmail(cleanData);
  const subject = `New Submission - ${formName || formId} | CS Formly`;
  const senderName = fromName || "CS Formly";

  if (recipients.length === 0 && ccRecipients.length === 0) {
    console.warn(`No notification recipients defined for form ${formId}. Skipping email notification.`);
    return;
  }

  if (!fromUser) {
    console.warn(`No sender email defined for form ${formId}. Skipping email notification.`);
    return;
  }

  // Pre-build common parts to save time
  let baseHtml;
  if (customTemplateEnabled && customTemplateBody) {
    baseHtml = customTemplateBody;

    // Support an {{AllFields}} macro that dynamically dumps all form fields
    if (baseHtml.includes('{{AllFields}}') || baseHtml.includes('{AllFields}')) {
      const rowsHtml = Object.entries(normalizedData)
        .map(([key, value]) => {
          const displayValue = renderDisplayValue(value, {
            key,
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
      baseHtml = baseHtml.replace(/\{\{AllFields\}\}/g, allFieldsTable).replace(/\{AllFields\}/g, allFieldsTable);
    }

    for (const key in normalizedData) {
      const val = normalizedData[key];
      const safeVal = escapeHtml(valueToText(val));
      baseHtml = baseHtml.replace(new RegExp(`\\{\\{${key}\\}\\}`, "gi"), safeVal);
      baseHtml = baseHtml.replace(new RegExp(`\\{${key}\\}`, "gi"), safeVal);
    }

    const metaVars = {
      FormName: formName || formId,
      DashboardUrl: dashboardUrl,
      SubmittedAt: metadata.submittedAt || new Date().toLocaleString(),
      IpAddress: metadata.ipAddress || "Unknown"
    };

    for (const key in metaVars) {
      baseHtml = baseHtml.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'gi'), metaVars[key]);
      baseHtml = baseHtml.replace(new RegExp(`\\{${key}\\}`, 'gi'), metaVars[key]);
    }
  } else {
    baseHtml = buildSubmissionEmailHtml({
      formName,
      formId,
      dashboardUrl,
      cleanData: normalizedData,
      metadata,
    });
  }

  // Process CID images
  const urlBackedAttachments = collectUrlBackedAttachments(normalizedData, attachments);
  const finalAttachments = [...attachments, ...urlBackedAttachments];
  const finalHtml = processCidImages(baseHtml, finalAttachments);

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
    const rowsHtml = Object.entries(normalizedData)
      .map(([key, value]) => {
        const displayValue = renderDisplayValue(value, {
          key,
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

