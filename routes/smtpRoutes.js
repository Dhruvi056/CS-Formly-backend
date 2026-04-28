const express = require("express");
const router = express.Router();
const { protect } = require("../middlewares/authMiddleware")
const {
  testSmtp,
  createSmtpConfig,
  getSmtpConfigs,
  deleteSmtpConfig,
} = require("../controllers/smtpController");

// All SMTP routes should be protected (require a logged in user)
router.use(protect);

router.post("/test", testSmtp);
router.route("/").post(createSmtpConfig).get(getSmtpConfigs);
router.route("/:id").delete(deleteSmtpConfig);

module.exports = router;
