const User = require("../models/userModel");
const generateToken = require("../utils/generateToken");

const registerUser = async (req, res) => {
  try {
    const { firstName, lastName, email, password, role } = req.body;

    if (!firstName || !lastName || !email || !password) {
      return res.status(400).json({ message: "All fields are required" });
    }

    const userExists = await User.findOne({ email: email.toLowerCase() });
    if (userExists) {
      return res.status(400).json({ message: "User already exists" });
    }

    const user = await User.create({
      firstName,
      lastName,
      email: email.toLowerCase(),
      password,
      role: role || "vendor_admin",
    });

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
      token: generateToken(user._id),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "Email and password required" });
    }

    const user = await User.findOne({ email: email.toLowerCase() }).select(
      "+password"
    );

    if (user && (await user.matchPassword(password))) {
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
        token: generateToken(user._id),
      });
    }

    return res.status(401).json({ message: "Invalid email or password" });
  } catch (error) {
    return res.status(500).json({ message: error.message });
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
    });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(400).json({ message: "Email already in use" });
    }
    return res.status(500).json({ message: error.message });
  }
};

module.exports = { registerUser, loginUser, getMyProfile, updateMyProfile };

