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
      ccNotificationEmail: String,
      successMessage: {
        type: String,
        default: "",
      },
      redirectTo: String,
      /** Pro / Business only (see planLimits.planAllowsProOnlySettings) */

      customTemplateEnabled: { type: Boolean, default: false },
      customTemplateBody: { type: String, default: "" },
      /** Unlayer react-email-editor design JSON */
      customTemplateDesign: { type: mongoose.Schema.Types.Mixed, default: null },
      customFromEmail: { type: String, default: "" },
      hideBranding: { type: Boolean, default: false },

      autoresponderEnabled: { type: Boolean, default: false },
      autoresponderSubject: { type: String, default: "Thank you for your submission!" },
      autoresponderBody: { type: String, default: "We have received your submission. Thank you!" },
      autoresponderAttachmentUrl: { type: String, default: "" },
      autoresponderAttachmentName: { type: String, default: "" },
      autoresponderAttachmentRules: {
        type: [
          {
            key: { type: String, default: "" },
            attachmentUrl: { type: String, default: "" },
            attachmentName: { type: String, default: "" },
            subject: { type: String, default: "" },
            body: { type: String, default: "" },
          },
        ],
        default: [],
      },
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

