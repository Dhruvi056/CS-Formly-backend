const SmtpConfig = require("../models/smtpModel");
const nodemailer = require("nodemailer");
const { planAllowsProOnlySettings } = require("../utils/planLimits");

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
        rejectUnauthorized: false, // For testing, avoid strict cert checks
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
  const { host, port, encryption, username, password, fromName, fromEmail, isDefault } = req.body;

  if (!host || !port || !username || !password || !fromName || !fromEmail) {
    return res.status(400).json({ message: "All fields are required" });
  }

  // Plan Check: SMTP is for Pro and Business only
  if (req.user.role !== "super_admin" && !planAllowsProOnlySettings(req.user.subscriptionPlan)) {
    return res.status(403).json({
      message: "Custom SMTP white-labeling is a Pro/Business feature. Please upgrade your plan.",
      code: "PRO_FEATURE_REQUIRED",
    });
  }

  try {
    // If setting as default, unset others for this user
    if (isDefault) {
      await SmtpConfig.updateMany({ user: req.user._id }, { isDefault: false });
    }

    const newConfig = await SmtpConfig.create({
      user: req.user._id,
      host: host.trim(),
      port: Number(port),
      encryption: encryption || "TLS",
      username: username.trim(),
      password, // Note: storing plain text. Recommend adding encryption layer here later
      fromName: fromName.trim(),
      fromEmail: fromEmail.trim(),
      isDefault: isDefault || false,
    });

    return res.status(201).json(newConfig);
  } catch (error) {
    console.error("Create SMTP Error:", error);
    return res.status(500).json({ message: "Failed to save SMTP configuration" });
  }
};

// @desc    Get all SMTP configurations for logged-in user
// @route   GET /api/smtp
// @access  Private
const getSmtpConfigs = async (req, res) => {
  try {
    const configs = await SmtpConfig.find({ user: req.user._id }).select("-password"); // Do not return passwords
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
  const { host, port, encryption, username, password, fromName, fromEmail, isDefault } = req.body;

  try {
    const config = await SmtpConfig.findById(req.params.id);

    if (!config) {
      return res.status(404).json({ message: "Configuration not found" });
    }

    if (config.user.toString() !== req.user._id.toString()) {
      return res.status(401).json({ message: "Not authorized" });
    }

    // Plan Check: SMTP is for Pro and Business only
    if (req.user.role !== "super_admin" && !planAllowsProOnlySettings(req.user.subscriptionPlan)) {
      return res.status(403).json({
        message: "Custom SMTP white-labeling is a Pro/Business feature. Please upgrade your plan.",
        code: "PRO_FEATURE_REQUIRED",
      });
    }

    // If setting as default, unset others for this user
    if (isDefault) {
      await SmtpConfig.updateMany({ user: req.user._id }, { isDefault: false });
    }

    config.host = host ? host.trim() : config.host;
    config.port = port ? Number(port) : config.port;
    config.encryption = encryption || config.encryption;
    config.username = username ? username.trim() : config.username;
    if (password) config.password = password; // Only update password if provided
    config.fromName = fromName ? fromName.trim() : config.fromName;
    config.fromEmail = fromEmail ? fromEmail.trim() : config.fromEmail;
    config.isDefault = isDefault !== undefined ? isDefault : config.isDefault;

    const updatedConfig = await config.save();
    return res.status(200).json(updatedConfig);
  } catch (error) {
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

    await SmtpConfig.findByIdAndDelete(req.params.id);

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
