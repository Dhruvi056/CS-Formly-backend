const BYTES_GB = 1024 * 1024 * 1024;

/**
 * Single source of truth for plan caps (aligned with Pricing page).
 * `null` = unlimited for that metric.
 */
const PLAN_CONFIG = {
  free: {
    maxForms: 5,
    maxSubmissions: 50, // ⚠️ TEST VALUE — change to 3000 for production
    maxStorageBytes: 1 * BYTES_GB,
    maxFolders: 2,
  },
  pro: {
    maxForms: 15,
    maxSubmissions: 10000,
    maxStorageBytes: 5 * BYTES_GB,
    maxFolders: 5,
  },
  business: {
    maxForms: null,
    maxSubmissions: 50000,
    maxStorageBytes: 10 * BYTES_GB,
    maxFolders: null,
  },
};

function normalizePlan(plan) {
  const p = String(plan || "free").toLowerCase();
  if (p === "free" || p === "pro" || p === "business") return p;
  return "free";
}

function getPlanConfig(plan) {
  const p = normalizePlan(plan);
  return PLAN_CONFIG[p] || PLAN_CONFIG.free;
}

function getMaxFormsForPlan(plan) {
  return getPlanConfig(plan).maxForms;
}

function getMaxFoldersForPlan(plan) {
  return getPlanConfig(plan).maxFolders;
}

function getMaxSubmissionsForPlan(plan) {
  return getPlanConfig(plan).maxSubmissions;
}

function getMaxStorageBytesForPlan(plan) {
  return getPlanConfig(plan).maxStorageBytes;
}

/** Pro & Business only (per pricing: autoresponder, custom sender, remove branding). */
function planAllowsProOnlySettings(plan) {
  const p = normalizePlan(plan);
  return p === "pro" || p === "business";
}

module.exports = {
  PLAN_CONFIG,
  normalizePlan,
  getPlanConfig,
  getMaxFormsForPlan,
  getMaxFoldersForPlan,
  getMaxSubmissionsForPlan,
  getMaxStorageBytesForPlan,
  planAllowsProOnlySettings,
};
