require("dotenv").config();

const express = require("express");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");
const nodemailer = require("nodemailer");
const multer = require("multer");
const crypto = require("crypto");
const cors = require("cors");
const mongoose = require("mongoose");

const connectDB = require("./config/db");
const authRoutes = require("./routes/authRoutes");
const formRoutes = require("./routes/formRoutes");
const folderRoutes = require("./routes/folderRoutes");
const adminRoutes = require("./routes/adminRoutes");
const submissionRoutes = require("./routes/submissionRoutes");
const billingRoutes = require("./routes/billingRoutes");
const smtpRoutes = require("./routes/smtpRoutes");
const { handleStripeWebhook } = require("./controllers/billingController");

const User = require("./models/userModel");
const Form = require("./models/formModel");
const Submission = require("./models/submissionModel");
const SmtpConfig = require("./models/smtpModel");
const {
  parseNotificationEmails,
  sendSubmissionNotificationEmails,
  sendAutoresponderEmail,
} = require("./utils/submissionEmail");

const {
  buildKey,
  publicUrlForKey,
  presignPutUrl,
  uploadBuffer,
} = require("./utils/spaces");
const { assertOwnerCanAcceptSubmission } = require("./utils/planUsage");

const app = express();
const PORT = process.env.PORT || 3000;
const IS_PRODUCTION = process.env.NODE_ENV === "production";

// Enable trust proxy for Cloudways/Nginx to correctly detect protocol (HTTP/HTTPS) and host
app.set('trust proxy', 1);

// Preferred deployment structure:
// backend/
//   server.js
//   dist/  <- frontend build output copied here
const DIST_DIR = path.join(__dirname, "dist");
const LEGACY_CRA_BUILD_DIR = path.join(__dirname, "..", "frontend", "build");

// Robust detection: use DIST_DIR if index.html exists there, otherwise fallback to frontend/build
let FRONTEND_DIR = DIST_DIR;
if (!fs.existsSync(path.join(DIST_DIR, "index.html"))) {
  console.warn(`[WARN] index.html not found in ${DIST_DIR}, falling back to legacy build dir`);
  FRONTEND_DIR = LEGACY_CRA_BUILD_DIR;
}

console.log(`[INFO] Serving frontend from: ${FRONTEND_DIR}`);

const INDEX_HTML = path.join(FRONTEND_DIR, "index.html");

connectDB();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB per file
});


// CORS: allow requests from any origin (forms can be embedded anywhere).
// Keep credentials false so wildcard CORS remains valid.

app.use(
  cors({
    origin: true,
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

// Serve frontend static assets explicitly to avoid SPA fallback issues
app.use("/assets", express.static(path.join(FRONTEND_DIR, "assets"), { maxAge: '1d' }));
app.use("/static", express.static(path.join(FRONTEND_DIR, "static"), { maxAge: '1d' }));

// Serve all other frontend public assets
app.use(express.static(FRONTEND_DIR));

// Local Uploads Setup (Cloudways) - Renamed to local-storage to avoid conflicts
const UPLOADS_DIR = path.join(__dirname, "local-storage");
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}
// Serve local uploads
app.use("/uploads", express.static(UPLOADS_DIR));

app.use("/api/auth", authRoutes);
app.use("/api/forms", formRoutes);
app.use("/api/folders", folderRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/submissions", submissionRoutes);
app.use("/api/billing", billingRoutes);
app.use("/api/smtp", smtpRoutes);

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
  console.log("\n--- [DEBUG] Form Submission Received ---");
  console.log("Form ID:", formId);
  console.log("Content-Type:", req.headers["content-type"]);
  console.log("Body Keys:", Object.keys(req.body || {}));
  console.log("Files Count:", (req.files || []).length);
  console.log("---------------------------------------\n");

  if (!formId) {
    return res.status(400).json({ error: "Missing Form ID" });
  }
  if (!mongoose.Types.ObjectId.isValid(String(formId))) {
    return res.status(400).json({ error: "Invalid Form ID" });
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

    // Handle file uploads (if any)
    if (allFiles.length > 0) {
      const uploadPromises = allFiles.map(async (file) => {
        const originalName = file.originalname || "file";
        const fieldName = file.fieldname || "file";

        // Local Storage implementation
        const fileExt = path.extname(originalName);
        const fileName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${fileExt}`;
        const filePath = path.join(UPLOADS_DIR, fileName);

        fs.writeFileSync(filePath, file.buffer);

        // Construct public URL
        const requestBase = req.protocol && req.get("host") ? `${req.protocol}://${req.get("host")}` : "";
        const url = `${requestBase}/uploads/${fileName}`;

        /* DigitalOcean Spaces implementation (Commented out for now)
        const key = buildKey({ kind: "form", formId, fileName: originalName });
        const uploaded = await uploadBuffer({
          key,
          buffer: file.buffer,
          contentType: file.mimetype || "application/octet-stream",
          makePublic: UPLOADS_PUBLIC,
        });
        const url = uploaded.url;
        */

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
    await Submission.create({
      form: formId,
      data: dataMap,
      fileSize: newBytes,
    });

    if (planCheck.owner && planCheck.owner.role !== "super_admin" && newBytes > 0) {
      await User.findByIdAndUpdate(mongoForm.user, {
        $inc: { storageUsedBytes: newBytes },
      });
    }

    const recipients = parseNotificationEmails(
      mongoForm.settings?.notificationEmail
    );
    let dashboardBase =
      process.env.FRONTEND_URL ||
      (req.headers.origin && String(req.headers.origin)) ||
      "";

    if (dashboardBase.endsWith("/")) {
      dashboardBase = dashboardBase.slice(0, -1);
    }

    const dashboardUrl = dashboardBase
      ? `${dashboardBase}/forms/${formId}`
      : `/forms/${formId}`;

    try {
      // 1. Check if the user has a custom SMTP configuration
      const customSmtp = await SmtpConfig.findOne({ user: mongoForm.user, isDefault: true }).lean();

      let finalTransporter = transporter;
      let finalFromUser = process.env.EMAIL_USER;
      let finalFromName = "CS Formly";

      if (customSmtp) {
        console.log(`Using custom SMTP for user ${mongoForm.user}: ${customSmtp.host}`);
        try {
          finalTransporter = nodemailer.createTransport({
            host: customSmtp.host,
            port: customSmtp.port,
            secure: customSmtp.encryption === "SSL" || customSmtp.port === 465,
            auth: {
              user: customSmtp.username,
              pass: customSmtp.password,
            },
            tls: {
              rejectUnauthorized: false,
            },
          });
          finalFromUser = customSmtp.fromEmail;
          finalFromName = customSmtp.fromName;
        } catch (e) {
          console.error("Failed to create custom transporter, falling back to default:", e);
        }
      } else {
        console.log(`Using default system SMTP for user ${mongoForm.user}`);
      }

      const metadata = {
        submittedAt: new Date().toLocaleString("en-US", {
          day: "2-digit",
          month: "short",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          hour12: true,
        }),
        ipAddress: req.ip || req.headers["x-forwarded-for"] || req.connection.remoteAddress,
      };

      const emailAttachments = allFiles.map((f) => ({
        filename: f.originalname,
        content: f.buffer,
        contentType: f.mimetype,
      }));

      await sendSubmissionNotificationEmails({
        transporter: finalTransporter,
        fromUser: finalFromUser,
        fromName: finalFromName, // Added this parameter support
        formName: mongoForm.name,
        formId,
        dashboardUrl,
        cleanData,
        recipients,
        metadata,
        customTemplateEnabled: mongoForm.settings?.customTemplateEnabled,
        customTemplateBody: mongoForm.settings?.customTemplateBody,
        attachments: emailAttachments,
      });

      // 2. Handle Autoresponder
      if (mongoForm.settings?.autoresponderEnabled) {
        await sendAutoresponderEmail({
          transporter: finalTransporter,
          fromUser: finalFromUser,
          fromName: finalFromName,
          formName: mongoForm.name,
          formId,
          cleanData,
          metadata,
          autoresponderSubject: mongoForm.settings?.autoresponderSubject,
          autoresponderBody: mongoForm.settings?.autoresponderBody,
          staticAttachmentUrl: mongoForm.settings?.autoresponderAttachmentUrl,
          staticAttachmentName: mongoForm.settings?.autoresponderAttachmentName,
          attachments: emailAttachments,
        });
      }


    } catch (emailError) {
      console.error("Email sending failed:", emailError);
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

// Profile Upload API: local storage (Cloudways)
app.post("/api/upload", upload.single("file"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  try {
    const originalName = req.file.originalname || "file";
    const fileExt = path.extname(originalName);
    const fileName = `profile-${Date.now()}-${Math.round(Math.random() * 1e9)}${fileExt}`;
    const filePath = path.join(UPLOADS_DIR, fileName);

    fs.writeFileSync(filePath, req.file.buffer);

    const requestBase = req.protocol && req.get("host") ? `${req.protocol}://${req.get("host")}` : "";
    const url = `${requestBase}/uploads/${fileName}`;

    return res.json({ url, key: fileName });
  } catch (error) {
    console.error("Local upload error details:", error);
    return res.status(500).json({
      error: "Upload failed on local server",
      details: error.message
    });
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

    const requestBase =
      req.protocol && req.get("host") ? `${req.protocol}://${req.get("host")}` : null;
    let baseUri =
      (typeof origin === "string" && origin.startsWith("http") ? origin : null) ||
      process.env.FRONTEND_URL ||
      (IS_PRODUCTION ? requestBase : "http://localhost:3000");

    if (baseUri && baseUri.endsWith("/")) {
      baseUri = baseUri.slice(0, -1);
    }

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

// Catch all API requests that didn't match and return JSON 404
app.all("/api/*", (req, res) => {
  return res.status(404).json({ error: "API route not found" });
});

// SPA fallback route: return index.html for unknown non-API routes.
app.get("*", (req, res) => {
  if (!fs.existsSync(INDEX_HTML)) {
    return res.status(500).json({
      error:
        "Frontend build not found. Build frontend and copy output to backend/dist (or ensure ../frontend/build exists).",
    });
  }

  return res.sendFile(INDEX_HTML);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Backend running at http://0.0.0.0:${PORT}`);
  if (!IS_PRODUCTION && String(process.env.AUTO_OPEN_BROWSER || "") === "true") {
    const url = `http://localhost:${PORT}`;
    const opener =
      process.platform === "win32"
        ? `start "" "${url}"`
        : process.platform === "darwin"
          ? `open "${url}"`
          : `xdg-open "${url}"`;
    exec(opener, () => { });
  }
});

