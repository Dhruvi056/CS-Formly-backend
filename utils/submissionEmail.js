const path = require("path");

function escapeHtml(s) {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function parseNotificationEmails(raw) {
  if (!raw || typeof raw !== "string") return [];
  return raw
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s));
}

function buildSubmissionEmailHtml({ formName, formId, dashboardUrl, cleanData, metadata = {} }) {
  const { submittedAt, ipAddress } = metadata;
  const rows = Object.entries(cleanData)
    .map(([key, value]) => {
      let displayValue;
      if (Array.isArray(value)) {
        displayValue = value
          .map((v) =>
            typeof v === "string" && v.startsWith("http")
              ? `<a href="${escapeHtml(v)}" class="file-link">View Attachment</a>`
              : escapeHtml(v)
          )
          .join(", ");
      } else if (typeof value === "string" && value.startsWith("http")) {
        displayValue = `<a href="${escapeHtml(value)}" class="file-link">View Attachment</a>`;
      } else {
        displayValue = escapeHtml(value);
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
    body { font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f0f2f5; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 40px auto; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 20px 40px rgba(0,0,0,0.1); border: 1px solid #e1e8ed; }
    .header { background: linear-gradient(135deg, #6571ff 0%, #060c17 100%); padding: 40px 20px; text-align: center; color: white; }
    .logo { font-size: 32px; font-weight: 800; letter-spacing: -1px; margin-bottom: 5px; color: #ffffff; }
    .logo span { color: rgba(255,255,255,0.7); font-weight: 400; }
    .title { font-size: 16px; font-weight: 600; letter-spacing: 2px; opacity: 0.8; margin-top: 10px; }
    .content { padding: 40px; }
    .form-info { background-color: #f8f9fa; border-radius: 8px; padding: 20px; margin-bottom: 30px; }
    .form-name { font-size: 18px; font-weight: 700; color: #060c17; margin-bottom: 5px; }
    .form-url { font-size: 13px; color: #6571ff; text-decoration: none; word-break: break-all; }
    .submission-data { width: 100%; border-collapse: separate; border-spacing: 0 12px; }
    .submission-data th { text-align: left; vertical-align: top; padding: 0 15px 0 0; color: #7987a1; font-size: 12px; text-transform: uppercase; font-weight: 600; width: 35%; padding-top: 4px; }
    .submission-data td { padding-bottom: 12px; border-bottom: 1px solid #edf1f7; color: #060c17; font-size: 15px; font-weight: 500; word-break: break-all; }
    .meta-section { margin-top: 30px; padding-top: 20px; border-top: 2px dashed #edf1f7; }
    .meta-table { width: 100%; font-size: 13px; color: #7987a1; }
    .meta-table td { padding: 4px 0; }
    .meta-label { font-weight: 600; width: 40%; }
    .meta-value { color: #060c17; text-align: right; }
    .footer { background-color: #f8f9fa; padding: 30px; text-align: center; font-size: 13px; color: #aeb7c5; border-top: 1px solid #edf1f7; }
    .btn { display: inline-block; padding: 16px 36px; background-color: #6571ff; color: #ffffff !important; text-decoration: none; border-radius: 10px; font-weight: 600; font-size: 16px; box-shadow: 0 4px 14px rgba(101, 113, 255, 0.4); transition: all 0.2s ease; }
    .btn-container { text-align: center; padding-top: 40px; padding-bottom: 10px; }
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
}) {
  if (!recipients.length) {
    console.warn(`No recipients defined for form ${formId}. Skipping email notification.`);
    return;
  }
  if (!fromUser) {
    console.warn(`No sender email defined for form ${formId}. Skipping email notification.`);
    return;
  }

  let html;
  if (customTemplateEnabled && customTemplateBody) {
    html = customTemplateBody;

    // Support an {{AllFields}} macro that dynamically dumps all form fields
    if (html.includes('{{AllFields}}') || html.includes('{AllFields}')) {
      const rowsHtml = Object.entries(cleanData)
        .map(([key, value]) => {
          let displayValue;
          if (Array.isArray(value)) {
            displayValue = value
              .map((v) =>
                typeof v === "string" && v.startsWith("http")
                  ? `<a href="${escapeHtml(v)}" style="color: #6571ff; text-decoration: none; font-weight: 600;">View Attachment</a>`
                  : escapeHtml(v)
              )
              .join(", ");
          } else if (typeof value === "string" && value.startsWith("http")) {
            displayValue = `<a href="${escapeHtml(value)}" style="color: #6571ff; text-decoration: none; font-weight: 600;">View Attachment</a>`;
          } else {
            displayValue = escapeHtml(value);
          }
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

    for (const key in cleanData) {
      const val = cleanData[key];
      // support both {{key}} and {key}
      html = html.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'gi'), val);
      html = html.replace(new RegExp(`\\{${key}\\}`, 'gi'), val);
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
    html = buildSubmissionEmailHtml({ formName, formId, dashboardUrl, cleanData, metadata });
  }

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
    const rowsHtml = Object.entries(cleanData)
      .map(([key, value]) => {
        let displayValue;
        if (Array.isArray(value)) {
          displayValue = value
            .map((v) =>
              typeof v === "string" && v.startsWith("http")
                ? `<a href="${escapeHtml(v)}" style="color: #6571ff; text-decoration: none; font-weight: 600;">View Attachment</a>`
                : escapeHtml(v)
            )
            .join(", ");
        } else if (typeof value === "string" && value.startsWith("http")) {
          displayValue = `<a href="${escapeHtml(value)}" style="color: #6571ff; text-decoration: none; font-weight: 600;">View Attachment</a>`;
        } else {
          displayValue = escapeHtml(value);
        }
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
  for (const key in cleanData) {
    const val = cleanData[key];
    const regex = new RegExp(`\\\\{\\\\{${key}\\\\}\\\\}`, "gi");
    const regexSimple = new RegExp(`\\\\{${key}\\\\}`, "gi");
    html = html.replace(new RegExp(`\\{\\{${key}\\}\\}`, "gi"), val);
    html = html.replace(new RegExp(`\\{${key}\\}`, "gi"), val);
    subject = subject.replace(new RegExp(`\\{\\{${key}\\}\\}`, "gi"), val);
    subject = subject.replace(new RegExp(`\\{${key}\\}`, "gi"), val);
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

  console.log(`Sending autoresponder email to: ${to} from: ${fromUser} (${senderName})`);

  await transporter.sendMail({
    from: `"${senderName}" <${fromUser}>`,
    to,
    subject,
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
      ${html}
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
  parseNotificationEmails,
  buildSubmissionEmailHtml,
  sendSubmissionNotificationEmails,
  sendAutoresponderEmail,
};

