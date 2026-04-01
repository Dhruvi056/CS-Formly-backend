const express = require("express");
const router = express.Router();
const {
  getMetrics,
  getAllUsers,
  updateUser,
  deleteUser,
  getAllForms,
} = require("../controllers/adminController");
const { protect } = require("../middlewares/authMiddleware");

// All routes here are restricted via the controller itself to super_admin
router.get("/metrics", protect, getMetrics);
router.get("/users", protect, getAllUsers);
router.put("/users/:id", protect, updateUser);
router.delete("/users/:id", protect, deleteUser);
router.get("/forms", protect, getAllForms);

module.exports = router;

