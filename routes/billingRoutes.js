const express = require("express");
const {
  createCheckoutSession,
  completeCheckoutSession,
  getUsage,
  getPlanHistory,
} = require("../controllers/billingController");
const { protect } = require("../middlewares/authMiddleware");

const router = express.Router();

router.post("/create-checkout-session", protect, createCheckoutSession);
router.get("/complete-session", protect, completeCheckoutSession);
router.get("/usage", protect, getUsage);
router.get("/history", protect, getPlanHistory);

module.exports = router;
