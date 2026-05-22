const mongoose = require("mongoose");
const nodemailer = require("nodemailer");
const SmtpConfig = require("../models/smtpModel");

function buildTransporterFromConfig(config) {
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.encryption === "SSL" || config.port === 465,
    auth: {
      user: config.username,
      pass: config.password,
    },
    tls: {
      rejectUnauthorized: false,
    },
  });
}

/**
 * Pick SMTP for a form submission: assigned form → default account → any account → system.
 */
async function resolveMailerForForm({
  userId,
  formId,
  defaultTransporter,
  defaultFromUser,
  defaultFromName = "FormBridge.ai",
}) {
  let config = null;

  if (formId && mongoose.Types.ObjectId.isValid(String(formId))) {
    config = await SmtpConfig.findOne({
      user: userId,
      assignedFormIds: formId,
    }).lean();
  }

  if (!config) {
    config = await SmtpConfig.findOne({ user: userId, isDefault: true })
      .sort({ updatedAt: -1 })
      .lean();
  }

  if (!config) {
    config = await SmtpConfig.findOne({ user: userId })
      .sort({ isDefault: -1, updatedAt: -1 })
      .lean();
  }

  if (!config) {
    return {
      transporter: defaultTransporter,
      fromUser: defaultFromUser,
      fromName: defaultFromName,
      source: "system",
    };
  }

  try {
    return {
      transporter: buildTransporterFromConfig(config),
      fromUser: config.fromEmail,
      fromName: config.fromName,
      source: "custom",
      smtpConfigId: config._id,
    };
  } catch (err) {
    console.error("Failed to create custom transporter, falling back to default:", err);
    return {
      transporter: defaultTransporter,
      fromUser: defaultFromUser,
      fromName: defaultFromName,
      source: "system_fallback",
    };
  }
}

module.exports = {
  buildTransporterFromConfig,
  resolveMailerForForm,
};
