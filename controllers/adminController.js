const User = require("../models/userModel");
const Form = require("../models/formModel");
const Folder = require("../models/folderModel");

function toName(u) {
  const first = (u.firstName || "").trim();
  const last = (u.lastName || "").trim();
  return [first, last].filter(Boolean).join(" ").trim();
}

// Get metrics for Super Admin dashboard
const getMetrics = async (req, res) => {
  try {
    if (req.user.role !== "super_admin") {
      return res.status(403).json({ message: "Access forbidden: Super Admin only" });
    }

    const [usersCount, formsCount, foldersCount] = await Promise.all([
      User.countDocuments({ role: "vendor_admin" }),
      Form.countDocuments(),
      Folder.countDocuments(),
    ]);

    return res.json({
      users: usersCount,
      forms: formsCount,
      folders: foldersCount,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// Get all users for Super Admin dashboard
const getAllUsers = async (req, res) => {
  try {
    if (req.user.role !== "super_admin") {
      return res.status(403).json({ message: "Access forbidden" });
    }
    const users = await User.find({ role: "vendor_admin", isDeleted: { $ne: true } })
      .sort({ createdAt: -1 })
      .lean();

    return res.json(
      users.map((u) => ({
        ...u,
        name: u.name || toName(u) || "-",
        vendorId: u.vendorId || String(u._id),
      }))
    );
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// Update a vendor_admin user (Super Admin only)
const updateUser = async (req, res) => {
  try {
    if (req.user.role !== "super_admin") {
      return res.status(403).json({ message: "Access forbidden" });
    }
    const { id } = req.params;
    const user = await User.findById(id);
    if (!user) return res.status(404).json({ message: "User not found" });

    const { name, role, vendorId } = req.body || {};
    if (typeof name === "string") {
      const parts = name.trim().split(/\s+/).filter(Boolean);
      user.firstName = parts.shift() || user.firstName;
      user.lastName = parts.join(" ") || user.lastName;
    }
    if (role === "vendor_admin" || role === "super_admin") {
      user.role = role;
    }
    if (typeof vendorId === "string") {
      user.vendorId = vendorId.trim();
    }
    await user.save();

    return res.json({
      ...user.toObject(),
      name: toName(user),
      vendorId: user.vendorId || String(user._id),
    });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(400).json({ message: "Duplicate value" });
    }
    return res.status(500).json({ message: error.message });
  }
};

// Delete a vendor_admin user (Super Admin only)
const deleteUser = async (req, res) => {
  try {
    if (req.user.role !== "super_admin") {
      return res.status(403).json({ message: "Access forbidden" });
    }
    const { id } = req.params;
    const user = await User.findById(id);
    if (!user) return res.status(404).json({ message: "User not found" });
    user.isDeleted = true;
    user.deletedAt = new Date();
    await user.save();
    return res.json({ success: true, softDeleted: true });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// Get all forms for Super Admin dashboard
const getAllForms = async (req, res) => {
  try {
    if (req.user.role !== "super_admin") {
      return res.status(403).json({ message: "Access forbidden" });
    }
    const forms = await Form.find()
      .populate("user", "firstName lastName email role vendorId isDeleted")
      .populate("folderId", "name")
      .sort({ createdAt: -1 })
      .lean();
    return res.json(forms);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

module.exports = { getMetrics, getAllUsers, updateUser, deleteUser, getAllForms };

