const mongoose = require("mongoose");

// Added: a user reporting another user (reviewed manually by the admin)
const REPORT_REASONS = ["spam", "harassment", "fake_profile", "inappropriate_content", "other"];

const reportSchema = new mongoose.Schema(
  {
    reporterId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    reportedUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    reason: {
      type: String,
      required: true,
      enum: { values: REPORT_REASONS, message: "Please choose a reason for the report." },
    },
    details: { type: String, trim: true, maxlength: [1000, "Details can be at most 1000 characters."] },
    status: { type: String, enum: ["open", "reviewed"], default: "open" },
  },
  { timestamps: true }
);

// One report per reporter per user, so nobody can flood the admin inbox
reportSchema.index({ reporterId: 1, reportedUserId: 1 }, { unique: true });

const Report = mongoose.model("Report", reportSchema);
module.exports = { Report, REPORT_REASONS };
