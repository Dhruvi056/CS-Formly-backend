const Form = require("../models/formModel");
const Folder = require("../models/folderModel");
const { getMaxFormsForPlan, planAllowsProOnlySettings } = require("../utils/planLimits");

const createForm = async (req, res) => {
  try {
    const { name, timezone, folderId, settings, vendorId } = req.body;

    if (!name) {
      return res.status(400).json({ message: "Form name is required" });
    }
    if (!folderId) {
      return res.status(400).json({ message: "Folder is required to create a form" });
    }

    const folder = await Folder.findOne({ _id: folderId, user: req.user._id });
    if (!folder) {
      return res.status(400).json({ message: "Folder not found or not allowed" });
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
              "Autoresponder, custom email sender, and removing CS Formly branding require Pro or Business. Upgrade your plan under Upgrade plan.",
            code: "PRO_FEATURE_REQUIRED",
          });
        }
      }
      form.settings = { ...form.settings, ...settings };
    }

    const updatedForm = await form.save();
    return res.json(updatedForm);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

module.exports = {
  createForm,
  getForms,
  getFormById,
  updateForm,
  deleteForm,
};

