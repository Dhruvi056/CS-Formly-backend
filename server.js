require("dotenv").config();

const express = require("express");
const nodemailer = require("nodemailer");
const multer = require("multer");
const crypto = require("crypto");
const cors = require("cors");

const connectDB = require("./config/db");
const authRoutes = require("./routes/authRoutes");
const formRoutes = require("./routes/formRoutes");
const folderRoutes = require("./routes/folderRoutes");
const adminRoutes = require("./routes/adminRoutes");
const submissionRoutes = require("./routes/submissionRoutes");
const billingRoutes = require("./routes/billingRoutes");
const { handleStripeWebhook } = require("./controllers/billingController");

const User = require("./models/userModel");
const Form = require("./models/formModel");
const Submission = require("./models/submissionModel");
const {
  parseNotificationEmails,
  sendSubmissionNotificationEmails,
} = require("./utils/submissionEmail");

const {
  buildKey,
  publicUrlForKey,
  presignPutUrl,
  uploadBuffer,
} = require("./utils/spaces");
const { assertOwnerCanAcceptSubmission } = require("./utils/planUsage");

const app = express();
const PORT = process.env.PORT || 5000;

connectDB();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB per file
});


// CORS for separate frontend
app.use(
  cors({
    origin: process.env.FRONTEND_URL ? [process.env.FRONTEND_URL] : true,
    credentials: false,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Accept", "Stripe-Signature"],
  })
);

app.post(
  "/api/billing/webhook",
  express.raw({ type: "application/json" }),
  handleStripeWebhook
);

app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true, limit: "20mb" }));

app.get("/health", (req, res) => res.json({ ok: true }));

app.use("/api/auth", authRoutes);
app.use("/api/forms", formRoutes);
app.use("/api/folders", folderRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/submissions", submissionRoutes);
app.use("/api/billing", billingRoutes);

/* -------------------- Upload (DigitalOcean Spaces) -------------------- */
function isTruthy(v) {
  const s = String(v || "").trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "y";
}

const UPLOADS_PUBLIC = isTruthy(process.env.SPACES_PUBLIC_UPLOADS);

// Low-load path: frontend uploads directly to Spaces using this presigned URL.
app.post("/api/uploads/presign", async (req, res) => {
  try {
    const { kind, formId, fileName, contentType } = req.body || {};
    if (!fileName) return res.status(400).json({ error: "fileName is required" });
    if (kind !== "profile" && kind !== "form") {
      return res.status(400).json({ error: "kind must be profile or form" });
    }
    if (kind === "form" && !formId) {
      return res.status(400).json({ error: "formId is required for kind=form" });
    }

    if (kind === "form" && formId) {
      const formRow = await Form.findById(formId).select("user").lean();
      if (formRow?.user) {
        const fileSize = Number(req.body.fileSize) || 0;
        const preCheck = await assertOwnerCanAcceptSubmission(formRow.user, {
          newBytes: fileSize,
          countSubmission: false,
        });
        if (!preCheck.ok) {
          return res.status(preCheck.status).json({
            error: preCheck.message,
            code: preCheck.code,
          });
        }
      }
    }

    const key = buildKey({ kind, formId, fileName });
    const uploadUrl = await presignPutUrl({
      key,
      contentType: contentType || "application/octet-stream",
      expiresInSec: 60,
      makePublic: UPLOADS_PUBLIC,
    });
    const url = publicUrlForKey(key);

    return res.json({ key, uploadUrl, url });
  } catch (e) {
    return res.status(500).json({ error: e.message || "Failed to presign upload" });
  }
});

/* -------------------- Nodemailer Setup -------------------- */
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

/* -------------------- FORM SUBMIT API -------------------- */
async function handleFormSubmit(req, res) {
  const { formId } = req.params;

  if (!formId) {
    return res.status(400).json({ error: "Missing Form ID" });
  }

  try {
    const cleanData = {};
    const allFiles = [...(req.files || [])];

    // Detect embedded base64 files in JSON payload
    if (
      req.headers["content-type"] &&
      req.headers["content-type"].includes("application/json")
    ) {
      for (let key in req.body) {
        const val = req.body[key];
        if (val && typeof val === "object" && val.dataUrl) {
          try {
            const base64Data = val.dataUrl.split(",")[1];
            if (base64Data) {
              allFiles.push({
                fieldname: key,
                originalname: val.fileName || "file",
                mimetype: val.mimeType || "application/octet-stream",
                buffer: Buffer.from(base64Data, "base64"),
              });
              delete req.body[key];
            }
          } catch (e) {
            // ignore
          }
        }
      }
    }

    for (let key in req.body) {
      if (req.body[key] !== "" && key !== "_gotcha") {
        cleanData[key] = req.body[key];
      }
    }

    const mongoForm = await Form.findById(formId).select("name settings user").lean();

    if (!mongoForm) {
      return res.status(404).json({ error: "Form not found in MongoDB" });
    }

    const newBytes = allFiles.reduce((sum, f) => sum + (f.buffer ? f.buffer.length : 0), 0);
    const planCheck = await assertOwnerCanAcceptSubmission(mongoForm.user, {
      newBytes,
      countSubmission: true,
    });
    if (!planCheck.ok) {
      return res.status(planCheck.status).json({
        error: planCheck.message,
        code: planCheck.code,
        plan: planCheck.plan,
        limit: planCheck.limit,
      });
    }

    // Handle file uploads (if any) using DigitalOcean Spaces
    if (allFiles.length > 0) {
      const uploadPromises = allFiles.map(async (file) => {
        const originalName = file.originalname || "file";
        const fieldName = file.fieldname || "file";
        const key = buildKey({ kind: "form", formId, fileName: originalName });

        const { url } = await uploadBuffer({
          key,
          buffer: file.buffer,
          contentType: file.mimetype || "application/octet-stream",
          makePublic: UPLOADS_PUBLIC,
        });

        if (cleanData[fieldName] === undefined) {
          cleanData[fieldName] = url;
        } else if (Array.isArray(cleanData[fieldName])) {
          cleanData[fieldName].push(url);
        } else {
          cleanData[fieldName] = [cleanData[fieldName], url];
        }
      });

      await Promise.all(uploadPromises);
    }

    if (Object.keys(cleanData).length === 0) {
      return res.status(400).json({ error: "No form data received" });
    }

    const dataMap = new Map(Object.entries(cleanData));
    await Submission.create({ form: formId, data: dataMap });

    if (planCheck.owner && planCheck.owner.role !== "super_admin" && newBytes > 0) {
      await User.findByIdAndUpdate(mongoForm.user, {
        $inc: { storageUsedBytes: newBytes },
      });
    }

    const recipients = parseNotificationEmails(
      mongoForm.settings?.notificationEmail
    );
    const dashboardBase =
      process.env.FRONTEND_URL ||
      (req.headers.origin && String(req.headers.origin)) ||
      "";
    const dashboardUrl = dashboardBase
      ? `${dashboardBase}/forms/${formId}`
      : `/forms/${formId}`;

    try {
      await sendSubmissionNotificationEmails({
        transporter,
        fromUser: process.env.EMAIL_USER,
        formName: mongoForm.name,
        formId,
        dashboardUrl,
        cleanData,
        recipients,
      });
    } catch (emailError) {
      // ignore email failures
    }

    const { name, fname, lname } = cleanData;
    const fullName = name || [fname, lname].filter(Boolean).join(" ");
    const successPayload = {
      success: true,
      message: fullName
        ? `Form submitted successfully. Thank you, ${fullName}!`
        : "Form submitted successfully",
    };
    const acceptsHeader = req.headers.accept || "";
    const wantsJson = acceptsHeader.includes("application/json");

    if (wantsJson) return res.json(successPayload);
    return res.status(204).end();
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

// Profile Upload API (fallback path used by frontend if presigned upload fails)
app.post("/api/upload", upload.single("file"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  try {
    const key = buildKey({
      kind: "profile",
      fileName: req.file.originalname || "profile",
    });

    const { url } = await uploadBuffer({
      key,
      buffer: req.file.buffer,
      contentType: req.file.mimetype || "application/octet-stream",
      makePublic: UPLOADS_PUBLIC,
    });

    return res.json({ url, key });
  } catch (error) {
    return res.status(500).json({ error: "Upload failed" });
  }
});

// Public submit endpoints for embedded forms
app.post("/api/forms/:formId", upload.any(), handleFormSubmit);
app.post("/api/f/:formId", upload.any(), handleFormSubmit);

/* -------------------- AUTHENTICATION API (Mongo-based reset) -------------------- */
app.post("/api/auth/reset-password", async (req, res) => {
  const { email, origin } = req.body || {};
  if (!email) return res.status(400).json({ error: "Email is required" });

  try {
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.json({
        success: true,
        message: "If an account exists, a reset link has been sent.",
      });
    }

    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto
      .createHash("sha256")
      .update(rawToken)
      .digest("hex");

    user.resetPasswordTokenHash = tokenHash;
    user.resetPasswordExpiresAt = new Date(Date.now() + 60 * 60 * 1000);
    await user.save();

    const baseUri =
      (typeof origin === "string" && origin.startsWith("http") ? origin : null) ||
      process.env.FRONTEND_URL ||
      "http://localhost:3000";
    const customResetLink = `${baseUri}/reset-password?token=${rawToken}`;

    if (process.env.NODE_ENV !== "production") {
      console.log("[reset-password] DEV reset link:", customResetLink);
    }

    await transporter.sendMail({
      from: `"CS Formly" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "Reset your CS Formly Password",
      html: `
        <p>Click the link below to reset your password:</p>
        <p><a href="${customResetLink}">${customResetLink}</a></p>
      `,
    });

    return res.json({
      success: true,
      message: "Password reset email sent",
      ...(process.env.NODE_ENV !== "production"
        ? { devResetLink: customResetLink }
        : {}),
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.post("/api/auth/reset-password/confirm", async (req, res) => {
  const { token, password } = req.body || {};
  if (!token || !password) {
    return res.status(400).json({ error: "Token and new password are required" });
  }
  if (String(password).length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters" });
  }

  try {
    const tokenHash = crypto
      .createHash("sha256")
      .update(String(token))
      .digest("hex");
    const user = await User.findOne({
      resetPasswordTokenHash: tokenHash,
      resetPasswordExpiresAt: { $gt: new Date() },
    }).select("+password");

    if (!user) {
      return res.status(400).json({ error: "Reset link is invalid or has expired." });
    }

    user.password = password;
    user.resetPasswordTokenHash = "";
    user.resetPasswordExpiresAt = null;
    await user.save();

    return res.json({ success: true, message: "Password reset successfully." });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Backend running at http://localhost:${PORT}`);
});

