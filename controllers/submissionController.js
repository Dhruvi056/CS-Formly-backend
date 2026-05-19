const Submission = require("../models/submissionModel");
const Form = require("../models/formModel");
const User = require("../models/userModel");
const mongoose = require("mongoose");
const { findLatestKeyByFilename, publicUrlForKey, presignGetUrl } = require("../utils/spaces");
const { normalizeCleanDataForEmail } = require("../utils/submissionEmail");

const FILE_EXT_RE = /\.(pdf|doc|docx|xls|xlsx|csv|txt|png|jpe?g|gif|zip|rar|webp)$/i;

function looksLikeUrl(v = "") {
  const lower = String(v).toLowerCase();
  return lower.startsWith("http://") || lower.startsWith("https://");
}

function tryParseJson(value) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function normalizeSubmissionDataShape(rawData) {
  return normalizeCleanDataForEmail(rawData);
}

function normalizeValueForClient(formId, fieldName, value) {
  if (Array.isArray(value)) {
    return value.map((v) => normalizeValueForClient(formId, fieldName, v));
  }
  if (typeof value === "string") {
    if (looksLikeUrl(value)) return value;
  }
  return value;
}

function isTruthy(v) {
  const s = String(v || "").trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "y";
}

async function resolveSpacesFileUrl({ formId, fileName }) {
  const safeFormId = String(formId || "").trim();
  const safeFileName = String(fileName || "").trim();
  if (!safeFormId || !safeFileName) return "";

  // We store full URLs in new submissions. This endpoint exists only for legacy
  // rows where DB stored just a filename.
  const key = await findLatestKeyByFilename({
    prefix: `forms/${safeFormId}/`,
    fileName: safeFileName,
  });
  if (!key) return "";

  const isPublic = isTruthy(process.env.SPACES_PUBLIC_UPLOADS);
  if (isPublic) return publicUrlForKey(key);
  return await presignGetUrl({ key, expiresInSec: 60 });
}

const getSubmissions = async (req, res) => {
  try {
    const submissions = await Submission.find({
      form: req.params.formId,
      isDeleted: false,
    })
      .sort({ createdAt: -1 })
      .exec();

    const normalized = submissions.map((s) => {
      const o = s.toObject();
      if (o.data instanceof Map) {
        o.data = Object.fromEntries(o.data);
      }
      o.data = normalizeSubmissionDataShape(o.data);
      if (o.data && typeof o.data === "object") {
        const next = {};
        for (const [k, v] of Object.entries(o.data)) {
          next[k] = normalizeValueForClient(req.params.formId, k, v);
        }
        o.data = next;
      }
      return o;
    });

    return res.json(normalized);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

async function userCanManageSubmission(req, submission) {
  if (!submission) return false;
  if (req.user.role === "super_admin") return true;
  const formRow = await Form.findById(submission.form).select("user").lean();
  if (!formRow?.user) return false;
  return formRow.user.toString() === req.user._id.toString();
}

const deleteSubmission = async (req, res) => {
  try {
    const submission = await Submission.findById(req.params.id);
    if (!submission) {
      return res.status(404).json({ message: "Submission not found" });
    }

    if (!(await userCanManageSubmission(req, submission))) {
      return res.status(401).json({ message: "Not authorized" });
    }

    submission.isDeleted = true;
    submission.deletedAt = new Date();
    await submission.save();

    // Decrement storage usage if it had files
    if (submission.fileSize && submission.fileSize > 0) {
      const formRow = await Form.findById(submission.form).select("user").lean();
      if (formRow && formRow.user) {
        await User.findByIdAndUpdate(formRow.user, {
          $inc: { storageUsedBytes: -submission.fileSize },
        });
      }
    }

    return res.json({ message: "Submission removed" });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const bulkDeleteSubmissions = async (req, res) => {
  try {
    const { ids } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ message: "No submission IDs provided" });
    }

    let removedCount = 0;

    for (const id of ids) {
      const submission = await Submission.findById(id);
      if (!submission || submission.isDeleted) continue;

      if (!(await userCanManageSubmission(req, submission))) {
        return res.status(401).json({ message: "Not authorized" });
      }

      submission.isDeleted = true;
      submission.deletedAt = new Date();
      await submission.save();
      removedCount += 1;

      if (submission.fileSize && submission.fileSize > 0) {
        const formRow = await Form.findById(submission.form).select("user").lean();
        if (formRow?.user) {
          await User.findByIdAndUpdate(formRow.user, {
            $inc: { storageUsedBytes: -submission.fileSize },
          });
        }
      }
    }

    return res.json({ message: `${removedCount} submission(s) removed`, removedCount });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const resolveSubmissionFile = async (req, res) => {
  try {
    const { formId, fileName } = req.body || {};
    if (!formId || !fileName) {
      return res.status(400).json({ message: "formId and fileName are required" });
    }
    if (!FILE_EXT_RE.test(String(fileName))) {
      return res.status(400).json({ message: "Invalid fileName" });
    }

    const url = await resolveSpacesFileUrl({ formId, fileName });
    if (!url) {
      return res.status(404).json({ message: "File not found" });
    }
    return res.json({ url });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const getLatestSubmissionByForms = async (req, res) => {
  try {
    const { formIds } = req.body || {};
    if (!Array.isArray(formIds) || formIds.length === 0) {
      return res.status(400).json({ message: "formIds must be a non-empty array" });
    }
    const ids = formIds
      .map((id) => {
        try {
          return new mongoose.Types.ObjectId(String(id));
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    if (ids.length === 0) {
      return res.status(400).json({ message: "No valid formIds provided" });
    }

    const rows = await Submission.aggregate([
      { $match: { form: { $in: ids }, isDeleted: false } },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: "$form",
          latestCreatedAt: { $first: "$createdAt" },
          latestId: { $first: "$_id" },
        },
      },
    ]);

    const result = {};
    for (const r of rows) {
      result[String(r._id)] = {
        latestCreatedAtMs: r.latestCreatedAt ? new Date(r.latestCreatedAt).getTime() : 0,
        latestId: String(r.latestId || ""),
      };
    }

    return res.json({ result });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getSubmissions,
  deleteSubmission,
  bulkDeleteSubmissions,
  resolveSubmissionFile,
  getLatestSubmissionByForms,
};

