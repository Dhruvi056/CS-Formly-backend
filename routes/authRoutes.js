const express = require("express");
const {
  registerUser,
  loginUser,
  googleLogin,
  getAuthConfig,
  getMyProfile,
  updateMyProfile,
  changePassword,
  deleteAccount,
  verifyEmail,
} = require("../controllers/authController");
const { protect } = require("../middlewares/authMiddleware");

const router = express.Router();

router.get("/config", getAuthConfig);
router.post("/register", registerUser);
router.post("/login", loginUser);
router.post("/google", googleLogin);
router.get("/profile", protect, getMyProfile);
router.put("/profile", protect, updateMyProfile);
router.put("/change-password", protect, changePassword);
router.delete("/delete-account", protect, deleteAccount);
router.get("/verify-email", verifyEmail);

module.exports = router;

