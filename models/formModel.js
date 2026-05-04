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
      /** Pro / Business only (see planLimits.planAllowsProOnlySettings) */

      customTemplateEnabled: { type: Boolean, default: false },
      customTemplateBody: { type: String, default: "" },
      customFromEmail: { type: String, default: "" },
      hideBranding: { type: Boolean, default: false },

      autoresponderEnabled: { type: Boolean, default: false },
      autoresponderSubject: { type: String, default: "Thank you for your submission!" },
      autoresponderBody: { type: String, default: "We have received your submission. Thank you!" },
      autoresponderAttachmentUrl: { type: String, default: "" },
      autoresponderAttachmentName: { type: String, default: "" },
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

