const mongoose = require("mongoose");

const formSchema = mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: "User",
    },
    name: {
      type: String,
      required: [true, "Please add a form name"],
      trim: true,
    },
    timezone: {
      type: String,
      default: "UTC",
    },
    folderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Folder",
      default: null,
    },
    settings: {
      notificationEmail: String,
      successMessage: {
        type: String,
        default: "Form submitted successfully!",
      },
      redirectTo: String,
    },
    vendorId: {
      type: String,
      required: false,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Form", formSchema);

