const Folder = require("../models/folderModel");
const { getMaxFoldersForPlan } = require("../utils/planLimits");

const getFolders = async (req, res) => {
  try {
    const query = {};
    if (req.user.role !== "super_admin") {
      query.user = req.user._id;
    }

    const folders = await Folder.find(query).sort("-createdAt");
    return res.json(folders);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const createFolder = async (req, res) => {
  try {
    const { name, vendorId } = req.body;
    if (!name) return res.status(400).json({ message: "Folder name is required" });

    if (req.user.role !== "super_admin") {
      const plan = req.user.subscriptionPlan || "free";
      const maxFolders = getMaxFoldersForPlan(plan);
      if (maxFolders !== null) {
        const count = await Folder.countDocuments({ user: req.user._id });
        if (count >= maxFolders) {
          const label = plan === "free" ? "Free" : plan === "pro" ? "Pro" : plan;
          return res.status(403).json({
            message: `${label} plan allows up to ${maxFolders} folders (workspaces). Upgrade your plan to add more.`,
            code: "FOLDER_LIMIT_REACHED",
            limit: maxFolders,
            plan,
          });
        }
      }
    }

    const folder = await Folder.create({
      user: req.user._id,
      name,
      vendorId: vendorId || String(req.user._id),
    });

    return res.status(201).json(folder);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

module.exports = { getFolders, createFolder };

