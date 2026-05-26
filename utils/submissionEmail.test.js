/**
 * Run: node utils/submissionEmail.test.js
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  formatFieldValueForEmail,
  normalizeCleanDataForEmail,
} = require("./submissionEmail");
const {
  prepareBrandedEmail,
  resolveLogoPath,
  EMAIL_LOGO_CID,
  EMAIL_LOGO_PATH,
} = require("./emailBrand");

assert.strictEqual(formatFieldValueForEmail("on"), "Yes");
assert.strictEqual(normalizeCleanDataForEmail({ Nda: "on" }).Nda, "Yes");

assert.ok(fs.existsSync(EMAIL_LOGO_PATH), `email logo missing: ${EMAIL_LOGO_PATH}`);
assert.ok(
  resolveLogoPath().endsWith("formbridge-email-logo.png"),
  "must use email-only logo file"
);
assert.ok(
  !resolveLogoPath().includes(path.join("frontend", "public")),
  "must not use sidebar logo path"
);

const sample = `<div class="header"><!--FORMBRIDGE_EMAIL_LOGO--></div>`;
const { html, attachments } = prepareBrandedEmail(sample, []);
assert.ok(html.includes("cid:formbridge-email-logo"), html);
assert.ok(!html.includes("background:#ffffff"), "email logo should not use white pill");
assert.ok(attachments.some((a) => a.cid === EMAIL_LOGO_CID));

console.log("submissionEmail.test.js: all passed");
