const express = require("express");
const router = express.Router();
const {
  createForm,
  getForms,
  deleteForm,
  getFormById,
  updateForm,
} = require("../controllers/formController");
const { protect } = require("../middlewares/authMiddleware");

router.route("/").get(protect, getForms).post(protect, createForm);

router.route("/:id")
  .get(protect, getFormById)
  .put(protect, updateForm)
  .delete(protect, deleteForm);

module.exports = router;

