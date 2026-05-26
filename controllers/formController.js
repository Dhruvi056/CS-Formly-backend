const mongoose = require("mongoose");
const Form = require("../models/formModel");
const Folder = require("../models/folderModel");
const { getMaxFormsForPlan, planAllowsProOnlySettings } = require("../utils/planLimits");

/** "None (Direct Form)" sends ""; store null instead of casting "" to ObjectId. */
function normalizeOptionalFolderId(folderId) {
  if (folderId == null || folderId === "" || folderId === "null") {
    return { value: null };
  }
  const id = String(folderId).trim();
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return { error: "Invalid folder selected." };
  }
  return { value: id };
}

const createForm = async (req, res) => {
  try {
    const { name, timezone, folderId: rawFolderId, settings, vendorId } = req.body;

    if (!name) {
      return res.status(400).json({ message: "Form name is required" });
    }

    const folderResolved = normalizeOptionalFolderId(rawFolderId);
    if (folderResolved.error) {
      return res.status(400).json({ message: folderResolved.error });
    }
    const folderId = folderResolved.value;

    if (folderId) {
      const folder = await Folder.findOne({ _id: folderId, user: req.user._id });
      if (!folder) {
        return res.status(400).json({ message: "Folder not found or not allowed" });
      }
    }

    if (req.user.role !== "super_admin") {
      const plan = req.user.subscriptionPlan || "free";
      const maxForms = getMaxFormsForPlan(plan);
      if (maxForms !== null) {
        const count = await Form.countDocuments({ user: req.user._id });
        if (count >= maxForms) {
          const label = plan === "free" ? "Free" : plan === "pro" ? "Pro" : plan;
          return res.status(403).json({
            message: `${label} plan allows up to ${maxForms} forms. Upgrade your plan to create more.`,
            code: "FORM_LIMIT_REACHED",
            limit: maxForms,
            plan,
          });
        }
      }
    }

    const form = await Form.create({
      user: req.user._id,
      name,
      timezone,
      folderId,
      settings,
      vendorId: vendorId || String(req.user._id),
    });

    return res.status(201).json(form);
  } catch (error) {
    if (error.name === "ValidationError") {
      return res.status(400).json({
        message: "Could not create form. Check the folder and other fields.",
      });
    }
    return res.status(500).json({ message: error.message });
  }
};

const getForms = async (req, res) => {
  try {
    const query = {};

    if (req.user.role !== "super_admin") {
      query.user = req.user._id;
    }

    const forms = await Form.find(query)
      .populate("folderId", "name")
      .sort("-createdAt");

    return res.json(forms);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const deleteForm = async (req, res) => {
  try {
    const form = await Form.findById(req.params.id);
    if (!form) {
      return res.status(404).json({ message: "Form not found" });
    }

    if (form.user.toString() !== req.user._id.toString()) {
      return res.status(401).json({ message: "User not authorized" });
    }

    await form.deleteOne();
    return res.json({ message: "Form removed successfully" });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const getFormById = async (req, res) => {
  try {
    const form = await Form.findById(req.params.id).populate("folderId", "name");
    if (!form) {
      return res.status(404).json({ message: "Form not found" });
    }

    if (req.user.role !== "super_admin") {
      if (form.user.toString() !== req.user._id.toString()) {
        return res.status(401).json({ message: "Not authorized to view this form" });
      }
    }

    return res.json(form);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const updateForm = async (req, res) => {
  try {
    const form = await Form.findById(req.params.id);
    if (!form) {
      return res.status(404).json({ message: "Form not found" });
    }

    if (req.user.role !== "super_admin") {
      if (form.user.toString() !== req.user._id.toString()) {
        return res.status(401).json({ message: "Not authorized to update this form" });
      }
    }

    const { name, folderId, timezone, settings } = req.body;

    if (name) form.name = name;
    if (folderId !== undefined) {
      if (folderId === "" || folderId === null) {
        form.folderId = null;
      } else {
        const folderOk = await Folder.findOne({ _id: folderId, user: req.user._id });
        if (!folderOk) {
          return res.status(400).json({ message: "Folder not found or not allowed" });
        }
        form.folderId = folderId;
      }
    }
    if (timezone) form.timezone = timezone;
    if (settings) {
      if (req.user.role !== "super_admin" && !planAllowsProOnlySettings(req.user.subscriptionPlan)) {
        const cur = form.settings && typeof form.settings.toObject === "function"
          ? form.settings.toObject()
          : form.settings || {};
        const merged = { ...cur, ...settings };
        const wantsProOnly =
          merged.autoresponderEnabled === true ||
          (typeof merged.customFromEmail === "string" && merged.customFromEmail.trim() !== "") ||
          merged.hideBranding === true;
        if (wantsProOnly) {
          return res.status(403).json({
            message:
              "Autoresponder, custom email sender, and removing formbridge.ai branding require Pro or Business. Upgrade your plan under Upgrade plan.",
            code: "PRO_FEATURE_REQUIRED",
          });
        }
      }

      // Explicitly update each field in settings to ensure Mongoose tracks changes correctly
      const currentSettings = form.settings || {};
      const newSettings = { ...currentSettings.toObject?.() || currentSettings, ...settings };
      
      // Use form.set to ensure Mongoose detects the nested object change
      form.set('settings', newSettings);
    }

    const updatedForm = await form.save();
    return res.json(updatedForm);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const saveTemplate = async (req, res) => {
  try {
    const form = await Form.findById(req.params.id);
    if (!form) {
      return res.status(404).json({ message: "Form not found" });
    }

    if (req.user.role !== "super_admin") {
      if (form.user.toString() !== req.user._id.toString()) {
        return res.status(401).json({ message: "Not authorized" });
      }
    }

    const {
      customTemplateEnabled,
      customTemplateBody,
      customTemplateDesign,
    } = req.body;

    const currentSettings =
      form.settings && typeof form.settings.toObject === "function"
        ? form.settings.toObject()
        : form.settings || {};

    const nextSettings = {
      ...currentSettings,
      customTemplateEnabled:
        customTemplateEnabled !== undefined
          ? !!customTemplateEnabled
          : currentSettings.customTemplateEnabled,
      customTemplateBody:
        customTemplateBody !== undefined
          ? String(customTemplateBody || "")
          : currentSettings.customTemplateBody,
    };

    if (customTemplateDesign !== undefined) {
      nextSettings.customTemplateDesign = customTemplateDesign || null;
    }

    form.set("settings", nextSettings);

    const updatedForm = await form.save();
    return res.json(updatedForm);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const testTemplate = async (req, res) => {
  try {
    const form = await Form.findById(req.params.id);
    if (!form) {
      return res.status(404).json({ message: "Form not found" });
    }

    if (req.user.role !== "super_admin") {
      if (form.user.toString() !== req.user._id.toString()) {
        return res.status(401).json({ message: "Not authorized" });
      }
    }

    const {
      templateBody,
      sendEmail = true,
    } = req.body;

    const htmlSource =
      templateBody ||
      form.settings?.customTemplateBody ||
      "";

    if (!htmlSource) {
      return res.status(400).json({ message: "Template body is required" });
    }

    const {
      applyCustomTemplatePlaceholders,
      getSampleTemplateData,
    } = require("../utils/emailTemplate");
    const { prepareBrandedEmail } = require("../utils/emailBrand");
    const { resolveMailerForForm } = require("../utils/resolveSmtp");
    const { resolveDashboardUrl } = require("../utils/dashboardUrl");
    const nodemailer = require("nodemailer");

    const sampleData = getSampleTemplateData();
    const dashboardUrl = resolveDashboardUrl(form._id, req);

    const templatedHtml = applyCustomTemplatePlaceholders(htmlSource, {
      formName: form.name,
      formId: String(form._id),
      dashboardUrl,
      cleanData: sampleData,
      metadata: {
        submittedAt: new Date().toLocaleString("en-US", {
          day: "2-digit",
          month: "short",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          hour12: true,
        }),
        ipAddress: "127.0.0.1",
      },
    });
    const { html: processedHtml, attachments: testAttachments } =
      prepareBrandedEmail(templatedHtml, []);

    if (!sendEmail) {
      return res.json({
        message: "Preview generated",
        html: processedHtml,
      });
    }

    if (!req.user.email) {
      return res.status(400).json({ message: "Your account has no email address" });
    }

    const defaultTransporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    const mailer = await resolveMailerForForm({
      userId: form.user,
      formId: form._id,
      defaultTransporter,
      defaultFromUser: process.env.EMAIL_USER,
      defaultFromName: "formbridge.ai",
    });

    await mailer.transporter.sendMail({
      from: `"${mailer.fromName || "formbridge.ai"}" <${mailer.fromUser}>`,
      to: req.user.email,
      subject: `Test Custom Template - ${form.name}`,
      html: processedHtml,
      attachments: testAttachments,
    });

    return res.json({
      message: `Test email sent to ${req.user.email}`,
      html: processedHtml,
    });
  } catch (error) {
    console.error("testTemplate error:", error);
    return res.status(500).json({ message: error.message || "Failed to send test email" });
  }
};

module.exports = {
  createForm,
  getForms,
  getFormById,
  updateForm,
  deleteForm,
  saveTemplate,
  testTemplate,
};

