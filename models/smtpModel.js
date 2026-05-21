const mongoose = require("mongoose");

const smtpSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    host: {
      type: String,
      required: true,
      trim: true,
    },
    port: {
      type: Number,
      required: true,
    },
    encryption: {
      type: String,
      enum: ["TLS", "SSL", "None"],
      default: "TLS",
    },
    username: {
      type: String,
      required: true,
      trim: true,
    },
    password: {
      type: String,
      required: true,
    },
    fromName: {
      type: String,
      required: true,
      trim: true,
    },
    fromEmail: {
      type: String,
      required: true,
      trim: true,
    },
    isDefault: {
      type: Boolean,
      default: false,
    },
    /** Forms that send notification + autoresponder mail through this SMTP account */
    assignedFormIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Form",
      },
    ],
  },
  { timestamps: true }
);

const SmtpConfig = mongoose.model("SmtpConfig", smtpSchema);

module.exports = SmtpConfig;
