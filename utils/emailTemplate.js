const {
  normalizeCleanDataForEmail,
  valueToText,
  buildEmailFieldsTableHtml,
} = require("./submissionEmail");
const { replaceLegacyDashboardLinks } = require("./dashboardUrl");
const { buildEmailLogoHtml } = require("./emailBrand");

function escapeHtml(s) {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Replace {{FieldName}}, {{AllFields}}, {{FormName}}, etc. in custom HTML templates.
 */
function applyCustomTemplatePlaceholders(html, {
  formName,
  formId,
  dashboardUrl,
  cleanData = {},
  metadata = {},
}) {
  if (!html || typeof html !== "string") return "";

  const normalizedData = normalizeCleanDataForEmail(cleanData);
  let baseHtml = html;

  if (baseHtml.includes("{{EmailLogo}}") || baseHtml.includes("{EmailLogo}")) {
    const logoHtml = buildEmailLogoHtml(null);
    baseHtml = baseHtml
      .replace(/\{\{EmailLogo\}\}/g, logoHtml)
      .replace(/\{EmailLogo\}/g, logoHtml);
  }

  if (baseHtml.includes("{{AllFields}}") || baseHtml.includes("{AllFields}")) {
    const allFieldsTable = buildEmailFieldsTableHtml(normalizedData, {
      linkStyle: "color: #004f9d; text-decoration: none; font-weight: 400;",
      linkClass: "",
    });
    baseHtml = baseHtml
      .replace(/\{\{AllFields\}\}/g, allFieldsTable)
      .replace(/\{AllFields\}/g, allFieldsTable);
  }

  for (const key in normalizedData) {
    const val = normalizedData[key];
    const safeVal = escapeHtml(valueToText(val));
    baseHtml = baseHtml.replace(new RegExp(`\\{\\{${key}\\}\\}`, "gi"), safeVal);
    baseHtml = baseHtml.replace(new RegExp(`\\{${key}\\}`, "gi"), safeVal);
  }

  const metaVars = {
    FormName: formName || formId,
    DashboardUrl: dashboardUrl || "",
    SubmittedAt: metadata.submittedAt || new Date().toLocaleString(),
    IpAddress: metadata.ipAddress || "Unknown",
  };

  for (const key in metaVars) {
    const val = metaVars[key];
    baseHtml = baseHtml.replace(new RegExp(`\\{\\{${key}\\}\\}`, "gi"), val);
    baseHtml = baseHtml.replace(new RegExp(`\\{${key}\\}`, "gi"), val);
  }

  return replaceLegacyDashboardLinks(baseHtml, dashboardUrl);
}

function getSampleTemplateData() {
  return {
    name: "Jane Doe",
    email: "jane@example.com",
    phone: "+1 (555) 123-4567",
    message: "This is a sample submission message for preview.",
    company: "Acme Corp",
  };
}

module.exports = {
  applyCustomTemplatePlaceholders,
  getSampleTemplateData,
};
