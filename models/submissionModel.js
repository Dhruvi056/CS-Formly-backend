const mongoose = require("mongoose");

const submissionSchema = mongoose.Schema(
  {
    form: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: "Form",
    },
    data: {
      type: Map,
      of: mongoose.Schema.Types.Mixed,
      required: true,
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
    deletedAt: Date,
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Submission", submissionSchema);

