const express = require("express");
const {
  createCheckoutSession,
  completeCheckoutSession,
  getUsage,
} = require("../controllers/billingController");
const { protect } = require("../middlewares/authMiddleware");

const router = express.Router();

router.post("/create-checkout-session", protect, createCheckoutSession);
router.get("/complete-session", protect, completeCheckoutSession);
router.get("/usage", protect, getUsage);

module.exports = router;
