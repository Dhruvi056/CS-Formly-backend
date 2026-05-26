/**
 * Resolve the public FormBridge dashboard base URL for notification emails.
 * - Dashboard test/preview: prefer browser Origin when it is a FormBridge app host.
 * - Live submissions: use PUBLIC_BASE_URL / FRONTEND_URL for the deployed environment.
 * - Legacy csformly.concatstring.com env values are ignored.
 */

const DEFAULT_DASHBOARD_BASE = "https://app.formbridge.ai";

/** Only this old dashboard host is skipped — other concatstring.com links in emails stay untouched. */
const LEGACY_DASHBOARD_HOST = "csformly.concatstring.com";

function normalizedEnvBaseUrl(value) {
  if (!value || typeof value !== "string") return "";
  return value.trim().replace(/\/+$/, "");
}

function isLocalHostLikeUrl(value) {
  if (!value || typeof value !== "string") return false;
  try {
    const parsed = new URL(value);
    return /^(localhost|127\.0\.0\.1)$/i.test(parsed.hostname);
  } catch (_) {
    return false;
  }
}

function isLegacyDashboardHost(hostname) {
  if (!hostname) return false;
  return hostname.toLowerCase() === LEGACY_DASHBOARD_HOST;
}

function isLegacyDashboardUrl(value) {
  if (!value) return false;
  try {
    return isLegacyDashboardHost(new URL(value).hostname);
  } catch (_) {
    return false;
  }
}

function isFormbridgeDashboardHost(hostname) {
  if (!hostname) return false;
  const h = hostname.toLowerCase();
  if (/^(localhost|127\.0\.0\.1)$/i.test(h)) return true;
  if (h === "formbridge.ai" || h.endsWith(".formbridge.ai")) return true;
  return false;
}

function isFormbridgeDashboardUrl(value) {
  if (!value) return false;
  try {
    return isFormbridgeDashboardHost(new URL(value).hostname);
  } catch (_) {
    return false;
  }
}

function originFromReferer(referer) {
  if (!referer || typeof referer !== "string") return "";
  try {
    return normalizedEnvBaseUrl(new URL(referer).origin);
  } catch (_) {
    return "";
  }
}

function isLocalApiRequest(req) {
  if (!req) return false;
  const raw =
    req.ip ||
    req.socket?.remoteAddress ||
    req.connection?.remoteAddress ||
    "";
  const ip = String(raw).replace(/^::ffff:/i, "");
  if (/^(127\.0\.0\.1|::1)$/.test(ip)) return true;
  const host = String(req.get?.("host") || "");
  return /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host);
}

function extractFormPathFromDashboardUrl(url) {
  if (!url || typeof url !== "string") return "";
  const match = url.match(/\/forms\/[a-f0-9]{24}/i);
  return match ? match[0] : "";
}

const DEFAULT_API_BASE = "https://app.formbridge.ai";

function getPublicRequestBase(req) {
  const publicBaseFromEnv = normalizedEnvBaseUrl(
    process.env.PUBLIC_BASE_URL || process.env.FRONTEND_URL
  );

  const forwardedHostRaw = req.headers["x-forwarded-host"];
  const forwardedProtoRaw = req.headers["x-forwarded-proto"];

  const forwardedHost = Array.isArray(forwardedHostRaw)
    ? forwardedHostRaw[0]
    : String(forwardedHostRaw || "").split(",")[0].trim();
  const forwardedProto = Array.isArray(forwardedProtoRaw)
    ? forwardedProtoRaw[0]
    : String(forwardedProtoRaw || "").split(",")[0].trim();

  const host = forwardedHost || req.get("host") || "";
  const proto = forwardedProto || req.protocol || "https";

  if (/^(127\.0\.0\.1|localhost)(:\d+)?$/i.test(host)) {
    return publicBaseFromEnv && !isLegacyDashboardUrl(publicBaseFromEnv)
      ? publicBaseFromEnv
      : "";
  }

  if (host) {
    const requestBase = `${proto}://${host}`.replace(/\/+$/, "");
    if (isLegacyDashboardUrl(requestBase)) return "";
    return requestBase;
  }

  return publicBaseFromEnv && !isLegacyDashboardUrl(publicBaseFromEnv)
    ? publicBaseFromEnv
    : "";
}

/** Public API base for uploaded file URLs (same host that serves /uploads). */
function resolvePublicApiBase(req) {
  const fromRequest = getPublicRequestBase(req);
  if (fromRequest) return fromRequest;

  const fromEnv = normalizedEnvBaseUrl(
    process.env.PUBLIC_BASE_URL || process.env.FRONTEND_URL
  );
  if (fromEnv && !isLegacyDashboardUrl(fromEnv)) return fromEnv;

  return DEFAULT_API_BASE;
}

function resolveDashboardBase(req) {
  const originBase = normalizedEnvBaseUrl(req?.headers?.origin);
  const refererBase = originFromReferer(req?.headers?.referer);
  const publicBase = normalizedEnvBaseUrl(process.env.PUBLIC_BASE_URL);
  const frontendBase = normalizedEnvBaseUrl(process.env.FRONTEND_URL);
  const requestBase = normalizedEnvBaseUrl(getPublicRequestBase(req));

  // Local API (127.0.0.1) — dashboard is on FRONTEND_URL / browser origin, not csformly env.
  if (isLocalApiRequest(req)) {
    if (originBase && isFormbridgeDashboardUrl(originBase)) return originBase;
    if (refererBase && isFormbridgeDashboardUrl(refererBase)) return refererBase;
    if (frontendBase && !isLegacyDashboardUrl(frontendBase)) return frontendBase;
    return "http://localhost:3001";
  }

  // User is on the FormBridge dashboard (local / staging / prod) — match that host.
  if (originBase && isFormbridgeDashboardUrl(originBase)) return originBase;
  if (refererBase && isFormbridgeDashboardUrl(refererBase)) return refererBase;

  if (publicBase && !isLegacyDashboardUrl(publicBase)) return publicBase;

  if (requestBase && !isLocalHostLikeUrl(requestBase)) return requestBase;

  if (originBase && !isLegacyDashboardUrl(originBase) && !isLocalHostLikeUrl(originBase)) {
    return originBase;
  }

  if (frontendBase && !isLegacyDashboardUrl(frontendBase)) return frontendBase;

  if (requestBase) return requestBase;
  if (originBase && !isLegacyDashboardUrl(originBase)) return originBase;

  return DEFAULT_DASHBOARD_BASE;
}

function sanitizeDashboardUrl(url, req) {
  if (!url) return url;
  const base = url.split("/forms/")[0] || url;
  if (!isLegacyDashboardUrl(base)) return url;

  const formPath = extractFormPathFromDashboardUrl(url);
  let fallbackBase = req ? resolveDashboardBase(req) : "";
  if (!fallbackBase || isLegacyDashboardUrl(fallbackBase)) {
    const frontendBase = normalizedEnvBaseUrl(process.env.FRONTEND_URL);
    fallbackBase =
      frontendBase && !isLegacyDashboardUrl(frontendBase)
        ? frontendBase
        : DEFAULT_DASHBOARD_BASE;
  }
  return formPath ? `${fallbackBase}${formPath}` : fallbackBase;
}

function resolveDashboardUrl(formId, req) {
  const id = formId != null ? String(formId) : "";
  const dashboardPath = id ? `/forms/${id}` : "";
  const dashboardBase = resolveDashboardBase(req);
  const url = dashboardBase ? `${dashboardBase}${dashboardPath}` : dashboardPath;
  return sanitizeDashboardUrl(url, req);
}

/**
 * Replace only the old csformly dashboard form links in saved templates (not other concatstring URLs).
 */
function replaceLegacyDashboardLinks(html, dashboardUrl) {
  if (!html || typeof html !== "string" || !dashboardUrl) return html;

  const safeUrl = String(dashboardUrl);
  return html
    .replace(/https?:\/\/csformly\.concatstring\.com\/forms\/[a-f0-9]{24}/gi, safeUrl)
    .replace(/https?:\/\/csformly\.concatstring\.com(?=["'>\s])/gi, safeUrl.split("/forms/")[0] || safeUrl);
}

module.exports = {
  getPublicRequestBase,
  resolvePublicApiBase,
  resolveDashboardBase,
  resolveDashboardUrl,
  sanitizeDashboardUrl,
  replaceLegacyDashboardLinks,
  isLegacyDashboardUrl,
  isFormbridgeDashboardUrl,
};
