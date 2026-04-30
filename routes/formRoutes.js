const express = require("express");
const router = express.Router();
const {
  createForm,
  getForms,
  deleteForm,
  getFormById,
  updateForm,
  saveTemplate,
  testTemplate,
} = require("../controllers/formController");
const { protect } = require("../middlewares/authMiddleware");

router.route("/").get(protect, getForms).post(protect, createForm);

router.route("/:id")
  .get(protect, getFormById)
  .put(protect, updateForm)
  .delete(protect, deleteForm);

router.route("/save-template/:id").post(protect, saveTemplate);
router.route("/test-template/:id").post(protect, testTemplate);

module.exports = router;

