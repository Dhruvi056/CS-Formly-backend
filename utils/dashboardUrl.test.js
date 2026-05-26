/**
 * Quick sanity checks for dashboard URL resolution (run: node utils/dashboardUrl.test.js)
 */
const assert = require("assert");
const {
  resolveDashboardUrl,
  sanitizeDashboardUrl,
  isLegacyDashboardUrl,
} = require("./dashboardUrl");

function mockReq({ origin, referer, host, proto = "https", ip = "203.0.113.10" } = {}) {
  return {
    headers: { origin, referer },
    get: (h) => (h === "host" ? host : undefined),
    protocol: proto,
    ip,
  };
}

const formId = "6a15431d3b644d143f097d9b";

// Legacy env is ignored when origin is FormBridge staging
process.env.PUBLIC_BASE_URL = "https://csformly.concatstring.com";
process.env.FRONTEND_URL = "http://localhost:3001";
const stagingUrl = resolveDashboardUrl(
  formId,
  mockReq({ origin: "https://staging.formbridge.ai" })
);
assert.ok(stagingUrl.startsWith("https://staging.formbridge.ai/forms/"), stagingUrl);

// Local dashboard test uses localhost origin
const localUrl = resolveDashboardUrl(
  formId,
  mockReq({ origin: "http://localhost:3001", ip: "127.0.0.1" })
);
assert.ok(localUrl.startsWith("http://localhost:3001/forms/"), localUrl);

// External form submit uses PUBLIC_BASE_URL when not legacy — clear legacy first
process.env.PUBLIC_BASE_URL = "https://staging.formbridge.ai";
const submitUrl = resolveDashboardUrl(
  formId,
  mockReq({ origin: "https://customer-website.com" })
);
assert.ok(submitUrl.startsWith("https://staging.formbridge.ai/forms/"), submitUrl);

assert.strictEqual(isLegacyDashboardUrl("https://csformly.concatstring.com"), true);
assert.strictEqual(isLegacyDashboardUrl("https://www.concatstring.com"), false);

// Other concatstring.com env still works if explicitly configured (not csformly host)
process.env.PUBLIC_BASE_URL = "https://www.concatstring.com";
const customUrl = resolveDashboardUrl(formId, mockReq({ origin: "https://customer-website.com" }));
assert.ok(customUrl.startsWith("https://www.concatstring.com/forms/"), customUrl);

// Local submission (127.0.0.1) must not use csformly even if PUBLIC_BASE_URL is legacy
process.env.PUBLIC_BASE_URL = "https://csformly.concatstring.com";
process.env.FRONTEND_URL = "http://localhost:3001";
const localSubmitUrl = resolveDashboardUrl(
  formId,
  mockReq({ origin: "https://csformly.concatstring.com", ip: "127.0.0.1" })
);
assert.ok(
  localSubmitUrl.startsWith("http://localhost:3001/forms/"),
  `expected localhost, got ${localSubmitUrl}`
);

assert.ok(
  sanitizeDashboardUrl(`https://csformly.concatstring.com/forms/${formId}`).startsWith(
    "http://localhost:3001/forms/"
  ),
  "sanitize must rewrite legacy URLs"
);

console.log("dashboardUrl.test.js: all passed");
