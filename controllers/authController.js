const User = require("../models/userModel");
const generateToken = require("../utils/generateToken");
const crypto = require("crypto");
const nodemailer = require("nodemailer");
const { OAuth2Client } = require("google-auth-library");

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&]).{6,}$/;

function buildAuthUserResponse(user) {
  return {
    id: user._id,
    firstName: user.firstName,
    lastName: user.lastName,
    name: `${user.firstName} ${user.lastName}`.trim(),
    email: user.email,
    role: user.role,
    photoURL: user.photoURL || user.profileImage || "",
    coverURL: user.coverURL || user.coverImage || "",
    joined: user.joined || "",
    lives: user.lives || "",
    website: user.website || "",
    about: user.about || "",
    subscriptionPlan: user.subscriptionPlan || "free",
    isEmailVerified: user.isEmailVerified,
    createdAt: user.createdAt,
    token: generateToken(user._id),
  };
}

function normalizeBaseUrl(value = "") {
  return String(value || "").trim().replace(/\/+$/, "");
}

function isLocalhostLike(value = "") {
  try {
    const u = new URL(String(value));
    return /^(localhost|127\.0\.0\.1)$/i.test(u.hostname);
  } catch {
    return false;
  }
}

function getFrontendBaseUrl(req) {
  const envUrl = normalizeBaseUrl(
    process.env.PUBLIC_BASE_URL || process.env.FRONTEND_URL || process.env.CLIENT_URL
  );
  
  // Detection from headers (useful in production)
  const origin = normalizeBaseUrl(req.headers?.origin || "");
  const referer = normalizeBaseUrl(req.headers?.referer || "");
  const refererOrigin = (() => {
    if (!referer) return "";
    try {
      return normalizeBaseUrl(new URL(referer).origin);
    } catch {
      return "";
    }
  })();

  // Robust host detection handling proxies
  const forwardedHost = req.headers["x-forwarded-host"];
  const forwardedProto = req.headers["x-forwarded-proto"] || req.protocol || "https";
  const host = forwardedHost || req.get("host") || "";
  const requestBase = host ? normalizeBaseUrl(`${forwardedProto}://${host}`) : "";

  // Prioritize non-localhost origin/referer/requestHost
  if (origin && !isLocalhostLike(origin)) return origin;
  if (refererOrigin && !isLocalhostLike(refererOrigin)) return refererOrigin;
  if (requestBase && !isLocalhostLike(requestBase)) return requestBase;

  // Fallback to env variable, then finally localhost
  return (envUrl && !isLocalhostLike(envUrl)) ? envUrl : (envUrl || "http://localhost:3001");
}

function buildVerificationEmailHtml(link) {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Work+Sans:wght@400;600;700&display=swap');
    body { font-family: 'Work Sans', system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f3f2ec; margin: 0; padding: 20px 0; color: #111827; }
    .container { max-width: 640px; margin: 0 auto; background-color: #ffffff; border-radius: 14px; overflow: hidden; }
    .header { background: linear-gradient(135deg, #184BFB 0%, #0e1116 100%); padding: 34px 24px 28px; text-align: center; color: white; }
    .logo { font-size: 32px; font-weight: 800; letter-spacing: -0.6px; margin-bottom: 8px; color: #ffffff; }
    .logo span { color: rgba(255,255,255,0.78); font-weight: 500; }
    .title { font-size: 12px; font-weight: 600; letter-spacing: 2.5px; opacity: 0.95; text-transform: uppercase; }
    .content { padding: 24px; }
    .card { border-radius: 10px; overflow: hidden; margin-bottom: 16px; }
    .card-inner { padding: 14px 16px; }
    .card-title { margin: 0 0 6px; font-size: 18px; font-weight: 700; color: #111827; }
    .body-text { color: #374151; font-size: 15px; line-height: 1.6; margin-bottom: 20px; }
    .btn-container { text-align: center; padding: 10px 0 20px; }
    .btn { display: inline-block; padding: 12px 24px; background-color: #184BFB; color: #ffffff !important; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 15px; }
    .link-text { color: #6b7280; font-size: 12px; word-break: break-all; margin-top: 20px; text-align: center; }
    .link-text a { color: #184BFB; text-decoration: none; }
    .footer { background-color: #f8fafc; padding: 16px; text-align: center; font-size: 12px; color: #94a3b8; }
    .note { color: #9ca3af; font-size: 12px; margin-top: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo" style="font-family: 'Work Sans', sans-serif; font-weight: 600;">formbridge<span style="font-family: 'Instrument Serif', serif; color: rgba(255,255,255,0.95);">.ai</span></div>
      <div class="title">Verify Account</div>
    </div>
    <div class="content">
      <div class="card">
        <div class="card-inner">
          <h2 class="card-title">Welcome to formbridge.ai!</h2>
          <p class="body-text">We're excited to have you onboard. Please verify your email address to activate your account and start managing your forms.</p>
          
          <div class="btn-container">
            <a href="${link}" class="btn">Verify Email Address</a>
          </div>

          <p class="body-text" style="font-size: 13px; color: #6b7280; margin-bottom: 0;">
            If the button above doesn't work, copy and paste the following link into your browser:
          </p>
          <div class="link-text">
            <a href="${link}">${link}</a>
          </div>
          
          <p class="note">This verification link will expire in 24 hours.</p>
        </div>
      </div>
    </div>
    <div class="footer">
      This email was sent via <strong>formbridge.ai</strong> - the all-in-one headless form solution.
    </div>
  </div>
</body>
</html>`;
}

async function sendVerificationEmail({ to, link }) {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.warn("EMAIL_USER/EMAIL_PASS not configured.");
    return;
  }

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });

  const htmlTemplate = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
</head>
<body style="margin:0; padding:0; background:#f3f2ec; font-family:'Work Sans',Arial,sans-serif;">

  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f2ec; padding:40px 0;">
    <tr>
      <td align="center">

        <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff; border-radius:16px; overflow:hidden;">

          <!-- Header -->
          <tr>
            <td align="center"
              style="background:linear-gradient(135deg,#184BFB 0%,#0e1116 100%);
              padding:35px 20px; color:white;">

              <div style="font-size:32px; font-weight:600; font-family:'Work Sans',Arial,sans-serif;">
                formbridge<span style="font-family:'Instrument Serif',Georgia,serif; font-weight:400;">.ai</span>
              </div>

              <div style="margin-top:8px; font-size:12px; letter-spacing:2px;">
                VERIFY ACCOUNT
              </div>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding:40px 35px; color:#374151;">

              <h2 style="margin-top:0; color:#111827;">
                Welcome to formbridge.ai!
              </h2>

              <p style="font-size:15px; line-height:1.7;">
                Please verify your email address by clicking the button below.
              </p>

              <div style="text-align:center; margin:35px 0;">
                <a href="${link}"
                  style="
                    background:#184BFB;
                    color:#ffffff;
                    text-decoration:none;
                    padding:14px 28px;
                    border-radius:8px;
                    display:inline-block;
                    font-weight:600;
                    font-size:15px;
                  ">
                  Verify Email
                </a>
              </div>

              <p style="font-size:13px; color:#6b7280;">
                If button doesn't work, use this link:
              </p>

              <p style="word-break:break-all;">
                <a href="${link}" style="color:#184BFB;">
                  ${link}
                </a>
              </p>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center"
              style="background:#f8fafc;
              padding:18px;
              font-size:12px;
              color:#94a3b8;">

              This email was sent via
              <strong>formbridge.ai</strong>
            </td>
          </tr>

        </table>

      </td>
    </tr>
  </table>

</body>
</html>
`;

  await transporter.sendMail({
    from: `"formbridge.ai" <${process.env.EMAIL_USER}>`,
    to,
    subject: "Verify your formbridge.ai account",
    html: htmlTemplate,
  });
}

const registerUser = async (req, res) => {
  try {
    const { firstName, lastName, email, password,role } = req.body;

    const cleanEmail = email.trim().toLowerCase();

    if (!firstName || !lastName || !email || !password) {
      return res.status(400).json({ message: "All fields are required" });
  }

    // Email validation
    if (!emailRegex.test(email)) {
       return res.status(400).json({ message: "Invalid email format" });
    }

    // Password validation
    if (!passwordRegex.test(password)) {
      return res.status(400).json({
      message:"Password must include uppercase, lowercase, number and special character (min 6 chars)",
    });
}

    const userExists = await User.findOne({ email: email.toLowerCase() });
    if (userExists) {
      return res.status(400).json({ message: "User already exists" });
    }

    const rawVerificationToken = crypto.randomBytes(32).toString("hex");
    const verificationTokenHash = crypto
      .createHash("sha256")
      .update(rawVerificationToken)
      .digest("hex");

    const user = await User.create({
      firstName,
      lastName,
      email: email.toLowerCase(),
      password,
      role: role || "vendor_admin",
      isEmailVerified: false,
      emailVerificationTokenHash: verificationTokenHash,
      emailVerificationExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });

    const verifyLink = `${getFrontendBaseUrl(req)}/verify-email?token=${rawVerificationToken}`;
    try {
      await sendVerificationEmail({ to: user.email, link: verifyLink });
    } catch (mailErr) {
      console.error("Failed to send verification email:", mailErr.message);
    }

    return res.status(201).json({
      id: user._id,
      firstName: user.firstName,
      lastName: user.lastName,
      name: `${user.firstName} ${user.lastName}`.trim(),
      email: user.email,
      role: user.role,
      photoURL: user.photoURL || user.profileImage || "",
      coverURL: user.coverURL || user.coverImage || "",
      joined: user.joined || "",
      lives: user.lives || "",
      website: user.website || "",
      about: user.about || "",
      subscriptionPlan: user.subscriptionPlan || "free",
      createdAt: user.createdAt,
      isEmailVerified: user.isEmailVerified,
      message: "Signup successful. Please verify your email before logging in.",
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;
    const cleanEmail = email.trim().toLowerCase();
 
  if (!emailRegex.test(email)) {
    return res.status(400).json({ message: "Invalid email format" });
}

  if (password.length < 6) {
    return res.status(400).json({ message: "Invalid password format" });
  }
    const user = await User.findOne({ email: email.toLowerCase() }).select(
      "+password"
    );

    if (user && (await user.matchPassword(password))) {
      if (!user.isEmailVerified) {
        return res.status(403).json({
          message: "Please verify your email before logging in.",
          code: "EMAIL_NOT_VERIFIED",
        });
      }

      return res.json(buildAuthUserResponse(user));
    }

    return res.status(401).json({ message: "Invalid email or password" });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const googleLogin = async (req, res) => {
  try {
    const { credential } = req.body;
    const clientId = process.env.GOOGLE_CLIENT_ID;

    if (!clientId) {
      return res.status(503).json({ message: "Google sign-in is not configured on the server." });
    }

    if (!credential) {
      return res.status(400).json({ message: "Google credential is required." });
    }

    const googleClient = new OAuth2Client(clientId);
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: clientId,
    });

    const payload = ticket.getPayload();
    const googleId = payload?.sub;
    const email = String(payload?.email || "").trim().toLowerCase();
    const givenName = String(payload?.given_name || "").trim();
    const familyName = String(payload?.family_name || "").trim();
    const fullName = String(payload?.name || "").trim();
    const picture = String(payload?.picture || "").trim();

    if (!googleId || !email) {
      return res.status(400).json({ message: "Google account information is incomplete." });
    }

    if (!emailRegex.test(email)) {
      return res.status(400).json({ message: "Invalid email from Google account." });
    }

    let user = await User.findOne({ email }).select("+password");

    if (user) {
      if (user.isDeleted) {
        return res.status(403).json({ message: "This account has been deleted." });
      }

      if (user.googleId && user.googleId !== googleId) {
        return res.status(409).json({
          message: "This email is already linked to a different Google account.",
        });
      }

      if (!user.googleId) {
        user.googleId = googleId;
      }

      if (picture) {
        user.photoURL = picture;
        user.profileImage = picture;
      }

      user.isEmailVerified = true;
      await user.save();
    } else {
      const nameParts = fullName ? fullName.split(/\s+/) : [];
      const firstName = givenName || nameParts[0] || "User";
      const lastName = familyName || nameParts.slice(1).join(" ") || "";
      const randomPassword = crypto.randomBytes(32).toString("hex");

      user = await User.create({
        firstName,
        lastName,
        email,
        password: randomPassword,
        googleId,
        role: "vendor_admin",
        isEmailVerified: true,
        photoURL: picture,
      });
    }

    return res.json(buildAuthUserResponse(user));
  } catch (error) {
    console.error("Google login failed:", error?.message || error);
    return res.status(401).json({ message: "Google sign-in failed. Please try again." });
  }
};

const changePassword = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select("+password");

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: "All fields are required" });
    }

    // Validate new password (same as register)
    if (!passwordRegex.test(newPassword)) {
      return res.status(400).json({
        message:
          "Password must include uppercase, lowercase, number and special character (min 6 chars)",
      });
    }

    // Check current password
    const isMatch = await user.matchPassword(currentPassword);
    if (!isMatch) {
      return res.status(400).json({ message: "Current password is incorrect" });
    }

    // Update password (your model already hashes it)
    user.password = newPassword;

    await user.save();

    return res.json({ message: "Password updated successfully" });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const deleteAccount = async (req, res) => {
  try {
    const userId = req.user._id;

    const Form = require("../models/formModel");
    const Submission = require("../models/submissionModel");
    const Folder = require("../models/folderModel");

    const ownedForms = await Form.find({ user: userId }).select("_id").lean();
    const formIds = ownedForms.map((f) => f._id);

    if (formIds.length > 0) {
      await Submission.deleteMany({ form: { $in: formIds } });
    }

    await Form.deleteMany({ user: userId });
    await Folder.deleteMany({ user: userId });
    await User.findByIdAndDelete(userId);

    return res.json({ message: "Account deleted successfully" });

  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Error deleting account" });
  }
};

const getMyProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select("-password");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    return res.json({
      id: user._id,
      firstName: user.firstName,
      lastName: user.lastName,
      name: `${user.firstName} ${user.lastName}`.trim(),
      email: user.email,
      role: user.role,
      photoURL: user.photoURL || user.profileImage || "",
      coverURL: user.coverURL || user.coverImage || "",
      joined: user.joined || "",
      lives: user.lives || "",
      website: user.website || "",
      about: user.about || "",
      subscriptionPlan: user.subscriptionPlan || "free",
      createdAt: user.createdAt,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const updateMyProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select("-password");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const {
      firstName,
      lastName,
      email,
      photoURL,
      coverURL,
      joined,
      lives,
      website,
      about,
    } = req.body || {};

    if (typeof firstName === "string") user.firstName = firstName.trim();
    if (typeof lastName === "string") user.lastName = lastName.trim();
    if (typeof email === "string" && email.trim())
      user.email = email.trim().toLowerCase();
    if (typeof photoURL === "string") {
      user.photoURL = photoURL.trim();
      user.profileImage = photoURL.trim();
    }
    if (typeof coverURL === "string") {
      user.coverURL = coverURL.trim();
      user.coverImage = coverURL.trim();
    }
    if (typeof joined === "string") user.joined = joined.trim();
    if (typeof lives === "string") user.lives = lives.trim();
    if (typeof website === "string") user.website = website.trim();
    if (typeof about === "string") user.about = about.trim();

    await user.save();

    return res.json({
      id: user._id,
      firstName: user.firstName,
      lastName: user.lastName,
      name: `${user.firstName} ${user.lastName}`.trim(),
      email: user.email,
      role: user.role,
      photoURL: user.photoURL || user.profileImage || "",
      coverURL: user.coverURL || user.coverImage || "",
      joined: user.joined || "",
      lives: user.lives || "",
      website: user.website || "",
      about: user.about || "",
      subscriptionPlan: user.subscriptionPlan || "free",
      createdAt: user.createdAt,
    });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(400).json({ message: "Email already in use" });
    }
    return res.status(500).json({ message: error.message });
  }
};

const getAuthConfig = (req, res) => {
  const googleClientId =
    process.env.GOOGLE_CLIENT_ID || process.env.REACT_APP_GOOGLE_CLIENT_ID || "";
  return res.json({ googleClientId });
};

const verifyEmail = async (req, res) => {
  try {
    const token = String(req.query.token || "").trim();
    if (!token) {
      return res.status(400).json({ message: "Verification token is required." });
    }

    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const user = await User.findOne({
      emailVerificationTokenHash: tokenHash,
      emailVerificationExpiresAt: { $gt: new Date() },
    });

    if (!user) {
      return res.status(400).json({ message: "Invalid or expired verification link." });
    }

    user.isEmailVerified = true;
    user.emailVerificationTokenHash = "";
    user.emailVerificationExpiresAt = null;
    await user.save();

    return res.json({ message: "Email verified successfully. You can now log in." });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

module.exports = {
  registerUser,
  loginUser,
  googleLogin,
  getAuthConfig,
  getMyProfile,
  updateMyProfile,
  changePassword,
  deleteAccount,
  verifyEmail,
};

