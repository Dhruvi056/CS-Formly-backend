const mongoose = require("mongoose");

const notificationSchema = mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: "User",
    },
    formId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: "Form",
    },
    formName: String,
    dataSnippet: String,
    read: {
      type: Boolean,
      default: false,
    },
    type: {
      type: String,
      default: "submission",
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Notification", notificationSchema);

