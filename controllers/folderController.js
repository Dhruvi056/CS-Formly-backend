const Folder = require("../models/folderModel");

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

