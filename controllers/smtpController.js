const mongoose = require("mongoose");
const SmtpConfig = require("../models/smtpModel");
const Form = require("../models/formModel");
const nodemailer = require("nodemailer");
const { planAllowsProOnlySettings } = require("../utils/planLimits");

async function normalizeAndClaimFormAssignments(userId, assignedFormIds, excludeConfigId) {
  const raw = Array.isArray(assignedFormIds) ? assignedFormIds : [];
  const ids = [
    ...new Set(
      raw.map((id) => String(id).trim()).filter((id) => mongoose.Types.ObjectId.isValid(id))
    ),
  ];

  if (ids.length === 0) return [];

  const owned = await Form.find({ user: userId, _id: { $in: ids } }).select("_id").lean();
  if (owned.length !== ids.length) {
    const err = new Error("One or more selected forms are invalid.");
    err.code = "INVALID_FORM_IDS";
    throw err;
  }

  const objectIds = owned.map((f) => f._id);

  await SmtpConfig.updateMany(
    {
      user: userId,
      ...(excludeConfigId ? { _id: { $ne: excludeConfigId } } : {}),
    },
    { $pull: { assignedFormIds: { $in: objectIds } } }
  );

  return objectIds;
}

async function clearOtherDefaults(userId, keepConfigId) {
  await SmtpConfig.updateMany(
    { user: userId, _id: { $ne: keepConfigId } },
    { isDefault: false }
  );
}

function stripPasswordFromConfig(doc) {
  if (!doc) return doc;
  const obj = doc.toObject ? doc.toObject() : { ...doc };
  delete obj.password;
  return obj;
}

// @desc    Test SMTP Connection
// @route   POST /api/smtp/test
// @access  Private
const testSmtp = async (req, res) => {
  const { host, port, encryption, username, password } = req.body;

  if (!host || !port || !username || !password) {
    return res.status(400).json({ message: "All fields are required for testing" });
  }

  try {
    const isSecure = encryption === "SSL" || port === 465;

    const transporter = nodemailer.createTransport({
      host: host.trim(),
      port: Number(port),
      secure: isSecure,
      auth: {
        user: username.trim(),
        pass: password,
      },
      tls: {
        rejectUnauthorized: false,
      },
    });

    await transporter.verify();

    return res.status(200).json({ message: "SMTP Connection Successful!" });
  } catch (error) {
    console.error("SMTP Test Error:", error);
    return res.status(400).json({ message: `Connection failed: ${error.message}` });
  }
};

// @desc    Create a new SMTP configuration
// @route   POST /api/smtp
// @access  Private
const createSmtpConfig = async (req, res) => {
  const {
    host,
    port,
    encryption,
    username,
    password,
    fromName,
    fromEmail,
    isDefault,
    assignedFormIds,
  } = req.body;

  if (!host || !port || !username || !password || !fromName || !fromEmail) {
    return res.status(400).json({ message: "All fields are required" });
  }

  if (req.user.role !== "super_admin" && !planAllowsProOnlySettings(req.user.subscriptionPlan)) {
    return res.status(403).json({
      message: "Custom SMTP white-labeling is a Pro/Business feature. Please upgrade your plan.",
      code: "PRO_FEATURE_REQUIRED",
    });
  }

  try {
    const existingCount = await SmtpConfig.countDocuments({ user: req.user._id });
    const shouldBeDefault =
      existingCount === 0 ? true : Boolean(isDefault);

    const claimedFormIds = await normalizeAndClaimFormAssignments(
      req.user._id,
      assignedFormIds,
      null
    );

    const newConfig = await SmtpConfig.create({
      user: req.user._id,
      host: host.trim(),
      port: Number(port),
      encryption: encryption || "TLS",
      username: username.trim(),
      password,
      fromName: fromName.trim(),
      fromEmail: fromEmail.trim(),
      isDefault: shouldBeDefault,
      assignedFormIds: claimedFormIds,
    });

    if (shouldBeDefault) {
      await clearOtherDefaults(req.user._id, newConfig._id);
    }

    return res.status(201).json(stripPasswordFromConfig(newConfig));
  } catch (error) {
    if (error.code === "INVALID_FORM_IDS") {
      return res.status(400).json({ message: error.message, code: error.code });
    }
    console.error("Create SMTP Error:", error);
    return res.status(500).json({ message: "Failed to save SMTP configuration" });
  }
};

// @desc    Get all SMTP configurations for logged-in user
// @route   GET /api/smtp
// @access  Private
const getSmtpConfigs = async (req, res) => {
  try {
    const configs = await SmtpConfig.find({ user: req.user._id })
      .select("-password")
      .populate("assignedFormIds", "name")
      .sort({ isDefault: -1, updatedAt: -1 });
    return res.status(200).json(configs);
  } catch (error) {
    console.error("Get SMTP Error:", error);
    return res.status(500).json({ message: "Failed to fetch SMTP configurations" });
  }
};

// @desc    Update SMTP configuration
// @route   PUT /api/smtp/:id
// @access  Private
const updateSmtpConfig = async (req, res) => {
  const {
    host,
    port,
    encryption,
    username,
    password,
    fromName,
    fromEmail,
    isDefault,
    assignedFormIds,
  } = req.body;

  try {
    const config = await SmtpConfig.findById(req.params.id);

    if (!config) {
      return res.status(404).json({ message: "Configuration not found" });
    }

    if (config.user.toString() !== req.user._id.toString()) {
      return res.status(401).json({ message: "Not authorized" });
    }

    if (req.user.role !== "super_admin" && !planAllowsProOnlySettings(req.user.subscriptionPlan)) {
      return res.status(403).json({
        message: "Custom SMTP white-labeling is a Pro/Business feature. Please upgrade your plan.",
        code: "PRO_FEATURE_REQUIRED",
      });
    }

    config.host = host ? host.trim() : config.host;
    config.port = port ? Number(port) : config.port;
    config.encryption = encryption || config.encryption;
    config.username = username ? username.trim() : config.username;
    if (password) config.password = password;
    config.fromName = fromName ? fromName.trim() : config.fromName;
    config.fromEmail = fromEmail ? fromEmail.trim() : config.fromEmail;

    if (typeof isDefault === "boolean") {
      config.isDefault = isDefault;
      if (isDefault) {
        await clearOtherDefaults(req.user._id, config._id);
      }
    }

    if (assignedFormIds !== undefined) {
      config.assignedFormIds = await normalizeAndClaimFormAssignments(
        req.user._id,
        assignedFormIds,
        config._id
      );
    }

    const updatedConfig = await config.save();

    const populated = await SmtpConfig.findById(updatedConfig._id)
      .select("-password")
      .populate("assignedFormIds", "name");

    return res.status(200).json(populated);
  } catch (error) {
    if (error.code === "INVALID_FORM_IDS") {
      return res.status(400).json({ message: error.message, code: error.code });
    }
    console.error("Update SMTP Error:", error);
    return res.status(500).json({ message: "Failed to update SMTP configuration" });
  }
};

// @desc    Delete SMTP configuration
// @route   DELETE /api/smtp/:id
// @access  Private
const deleteSmtpConfig = async (req, res) => {
  try {
    const config = await SmtpConfig.findById(req.params.id);

    if (!config) {
      return res.status(404).json({ message: "Configuration not found" });
    }

    if (config.user.toString() !== req.user._id.toString()) {
      return res.status(401).json({ message: "Not authorized" });
    }

    const wasDefault = config.isDefault;
    await SmtpConfig.findByIdAndDelete(req.params.id);

    if (wasDefault) {
      const next = await SmtpConfig.findOne({ user: req.user._id }).sort({ updatedAt: -1 });
      if (next) {
        next.isDefault = true;
        await next.save();
      }
    }

    return res.status(200).json({ message: "Configuration removed" });
  } catch (error) {
    console.error("Delete SMTP Error:", error);
    return res.status(500).json({ message: "Failed to delete SMTP configuration" });
  }
};

module.exports = {
  testSmtp,
  createSmtpConfig,
  getSmtpConfigs,
  deleteSmtpConfig,
  updateSmtpConfig,
};
