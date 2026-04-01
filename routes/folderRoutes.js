const express = require("express");
const router = express.Router();
const { getFolders, createFolder } = require("../controllers/folderController");
const { protect } = require("../middlewares/authMiddleware");

router.route("/").get(protect, getFolders).post(protect, createFolder);

module.exports = router;

