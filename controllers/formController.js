const Form = require("../models/formModel");
const Folder = require("../models/folderModel");

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

