const Form = require("../models/formModel");
const Submission = require("../models/submissionModel");
const Folder = require("../models/folderModel");
const User = require("../models/userModel");
const {
  normalizePlan,
  getPlanConfig,
} = require("./planLimits");

async function countSubmissionsForUser(userId) {
  const formIds = await Form.find({ user: userId }).distinct("_id");
  if (!formIds.length) return 0;
  return Submission.countDocuments({
    form: { $in: formIds },
    isDeleted: { $ne: true },
  });
}

/**
 * Before accepting a new submission: check submission cap and storage cap (incl. new upload bytes).
 * @param {object} opts
 * @param {number} [opts.newBytes=0]
 * @param {boolean} [opts.countSubmission=true] If false, only checks storage (e.g. presigned upload before submit).
 */
async function assertOwnerCanAcceptSubmission(ownerId, { newBytes = 0, countSubmission = true } = {}) {
  const owner = await User.findById(ownerId).select("subscriptionPlan role storageUsedBytes");
  if (!owner) {
    return { ok: false, status: 404, message: "Account not found", code: "OWNER_NOT_FOUND" };
  }
  if (owner.role === "super_admin") {
    return { ok: true, owner };
  }

  const plan = normalizePlan(owner.subscriptionPlan);
  const config = getPlanConfig(plan);

  if (countSubmission) {
    const submissionCount = await countSubmissionsForUser(ownerId);
    if (config.maxSubmissions != null && submissionCount >= config.maxSubmissions) {
      return {
        ok: false,
        status: 403,
        message: `Your ${plan} plan allows up to ${config.maxSubmissions.toLocaleString()} submissions across all forms. Upgrade your plan to accept more.`,
        code: "SUBMISSION_LIMIT_REACHED",
        plan,
        limit: config.maxSubmissions,
      };
    }
  }

  if (config.maxStorageBytes != null) {
    const used = owner.storageUsedBytes || 0;
    if (used + newBytes > config.maxStorageBytes) {
      return {
        ok: false,
        status: 403,
        message: `Storage limit reached for your ${plan} plan (${formatBytes(config.maxStorageBytes)}). Upgrade for more space.`,
        code: "STORAGE_LIMIT_REACHED",
        plan,
        limitBytes: config.maxStorageBytes,
      };
    }
  }

  return { ok: true, owner };
}

function formatBytes(n) {
  if (n >= 1024 * 1024 * 1024) return `${(n / (1024 * 1024 * 1024)).toFixed(0)} GB`;
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(0)} MB`;
  return `${n} B`;
}

/**
 * Snapshot for GET /api/billing/usage and UI.
 */
async function getUsageSnapshot(userId) {
  const user = await User.findById(userId).select("subscriptionPlan role storageUsedBytes");
  if (!user) return null;

  const plan = normalizePlan(user.subscriptionPlan);
  const config = getPlanConfig(plan);

  const formCount = await Form.countDocuments({ user: userId });
  const folderCount = await Folder.countDocuments({ user: userId });
  const submissionCount = await countSubmissionsForUser(userId);
  const storageUsedBytes = user.storageUsedBytes || 0;

  return {
    plan,
    limits: {
      maxForms: config.maxForms,
      maxSubmissions: config.maxSubmissions,
      maxStorageBytes: config.maxStorageBytes,
      maxFolders: config.maxFolders,
    },
    usage: {
      forms: formCount,
      submissions: submissionCount,
      storageBytes: storageUsedBytes,
      folders: folderCount,
    },
  };
}

module.exports = {
  assertOwnerCanAcceptSubmission,
  countSubmissionsForUser,
  getUsageSnapshot,
};
