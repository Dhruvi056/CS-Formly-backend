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

function buildSubmissionEmailHtml({ formName, formId, dashboardUrl, cleanData }) {
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
    body { font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f4f7f6; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 20px auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.08); border: 1px solid #e1e8ed; }
    .header { background: linear-gradient(135deg, #6571ff 0%, #060c17 100%); padding: 40px 20px; text-align: center; color: white; }
    .logo { font-size: 32px; font-weight: 800; letter-spacing: -1px; margin-bottom: 5px; color: #ffffff; }
    .logo span { color: rgba(255,255,255,0.7); font-weight: 400; }
    .title { font-size: 16px; font-weight: 600; text-transform: uppercase; letter-spacing: 2px; opacity: 0.8; margin-top: 10px; }
    .content { padding: 40px; }
    .form-info { background-color: #f8f9fa; border-radius: 8px; padding: 20px; margin-bottom: 30px; border-left: 4px solid #6571ff; }
    .form-name { font-size: 18px; font-weight: 700; color: #060c17; margin-bottom: 5px; }
    .form-url { font-size: 13px; color: #6571ff; text-decoration: none; word-break: break-all; }
    .submission-data { width: 100%; border-collapse: separate; border-spacing: 0 12px; }
    .submission-data th { text-align: left; vertical-align: top; padding: 0 15px 0 0; color: #7987a1; font-size: 12px; text-transform: uppercase; font-weight: 600; width: 35%; padding-top: 4px; }
    .submission-data td { padding-bottom: 12px; border-bottom: 1px solid #edf1f7; color: #060c17; font-size: 15px; font-weight: 500; word-break: break-all; }
    .footer { background-color: #f8f9fa; padding: 30px; text-align: center; font-size: 13px; color: #aeb7c5; border-top: 1px solid #edf1f7; }
    .btn { display: inline-block; padding: 14px 28px; background-color: #6571ff; color: #ffffff !important; text-decoration: none; border-radius: 8px; font-weight: 600; margin-top: 30px; box-shadow: 0 4px 14px rgba(101, 113, 255, 0.4); }
    .file-link { color: #6571ff; text-decoration: none; font-weight: 600; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo">CS <span>Formly</span></div>
      <div class="title">New Submission</div>
    </div>
    <div class="content">
      <div class="form-info">
        <div class="form-name">${escapeHtml(formName || formId)}</div>
        <a href="${escapeHtml(dashboardUrl)}" class="form-url">${escapeHtml(dashboardUrl)}</a>
      </div>
      <table class="submission-data">${rows}</table>
      <div style="text-align: center; margin-top: 20px;">
        <a href="${escapeHtml(dashboardUrl)}" class="btn">Go to Dashboard</a>
      </div>
    </div>
    <div class="footer">
      This notification was sent via <strong>CS Formly</strong>.<br/>
      The all-in-one headless form solution.
    </div>
  </div>
</body>
</html>`;
}

async function sendSubmissionNotificationEmails({
  transporter,
  fromUser,
  formName,
  formId,
  dashboardUrl,
  cleanData,
  recipients,
}) {
  if (!recipients.length) return;
  if (!fromUser) return;

  const html = buildSubmissionEmailHtml({ formName, formId, dashboardUrl, cleanData });
  const subject = `New Form Submission - ${formName || formId}`;

  if (process.env.NODE_ENV === "production") {
    try {
      const { sendNotificationEmail } = require(path.join(
        __dirname,
        "../src/utils/emailService"
      ));
      for (const toEmail of recipients) {
        await sendNotificationEmail(toEmail, cleanData, formName || formId, dashboardUrl);
      }
      return;
    } catch (e) {
      /* fall through to nodemailer */
    }
  }

  for (const to of recipients) {
    await transporter.sendMail({
      from: `"CS Formly" <${fromUser}>`,
      to,
      subject,
      html,
    });
  }
}

module.exports = {
  parseNotificationEmails,
  buildSubmissionEmailHtml,
  sendSubmissionNotificationEmails,
};

