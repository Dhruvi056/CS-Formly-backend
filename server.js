require("dotenv").config();

const express = require("express");
const nodemailer = require("nodemailer");
const multer = require("multer");
const cloudinary = require("cloudinary").v2;
const crypto = require("crypto");
const cors = require("cors");

const connectDB = require("./config/db");
const authRoutes = require("./routes/authRoutes");
const formRoutes = require("./routes/formRoutes");
const folderRoutes = require("./routes/folderRoutes");
const adminRoutes = require("./routes/adminRoutes");
const submissionRoutes = require("./routes/submissionRoutes");

const User = require("./models/userModel");
const Form = require("./models/formModel");
const Submission = require("./models/submissionModel");
const {
  parseNotificationEmails,
  sendSubmissionNotificationEmails,
} = require("./utils/submissionEmail");

/* -------------------- Cloudinary Setup -------------------- */
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const app = express();
const PORT = process.env.PORT || 5000;

connectDB();

/* -------------------- Middleware -------------------- */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB per file
  },
});

app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true, limit: "20mb" }));

// CORS for separate frontend
app.use(
  cors({
    origin: process.env.FRONTEND_URL ? [process.env.FRONTEND_URL] : true,
    credentials: false,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Accept"],
  })
);

app.get("/health", (req, res) => res.json({ ok: true }));

app.use("/api/auth", authRoutes);
app.use("/api/forms", formRoutes);
app.use("/api/folders", folderRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/submissions", submissionRoutes);

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

    // Handle file uploads (if any) using Cloudinary
    if (allFiles.length > 0) {
      const uploadPromises = allFiles.map(async (file) => {
        const safeOriginalName = file.originalname || "file";
        const timestamp = Date.now();

        const isPdf =
          file.mimetype === "application/pdf" ||
          file.originalname.toLowerCase().endsWith(".pdf");
        const resourceType = isPdf ? "raw" : "auto";

        return new Promise((resolve, reject) => {
          const uploadStream = cloudinary.uploader.upload_stream(
            {
              folder: `forms/${formId}`,
              public_id: isPdf
                ? `${timestamp}-${safeOriginalName}`
                : `${timestamp}-${safeOriginalName.replace(/\.[^/.]+$/, "")}`,
              resource_type: resourceType,
            },
            (error, result) => {
              if (error) return reject(error);

              const publicUrl = result.secure_url.replace(
                "/upload/",
                "/upload/fl_attachment/"
              );
              const fieldName = file.fieldname || "file";

              if (cleanData[fieldName] === undefined) {
                cleanData[fieldName] = publicUrl;
              } else if (Array.isArray(cleanData[fieldName])) {
                cleanData[fieldName].push(publicUrl);
              } else {
                cleanData[fieldName] = [cleanData[fieldName], publicUrl];
              }
              resolve(result);
            }
          );

          const { Readable } = require("stream");
          const readableStream = new Readable();
          readableStream.push(file.buffer);
          readableStream.push(null);
          readableStream.pipe(uploadStream);
        });
      });

      await Promise.all(uploadPromises);
    }

    if (Object.keys(cleanData).length === 0) {
      return res.status(400).json({ error: "No form data received" });
    }

    const mongoForm = await Form.findById(formId)
      .select("name settings")
      .lean();

    if (!mongoForm) {
      return res.status(404).json({ error: "Form not found in MongoDB" });
    }

    const dataMap = new Map(Object.entries(cleanData));
    await Submission.create({ form: formId, data: dataMap });

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

// Profile Upload API
app.post("/api/upload", upload.single("file"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  try {
    const uploadStream = cloudinary.uploader.upload_stream(
      { folder: "profile_photos", resource_type: "auto" },
      (error, result) => {
        if (error) return res.status(500).json({ error: "Cloudinary upload failed" });
        res.json({ url: result.secure_url });
      }
    );

    const { Readable } = require("stream");
    const readable = new Readable();
    readable.push(req.file.buffer);
    readable.push(null);
    readable.pipe(uploadStream);
  } catch (error) {
    res.status(500).json({ error: "Upload failed" });
  }
});

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

