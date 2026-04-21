const User = require("../models/userModel");
const Form = require("../models/formModel");
const Folder = require("../models/folderModel");

function toName(u) {
  const first = (u.firstName || "").trim();
  const last = (u.lastName || "").trim();
  return [first, last].filter(Boolean).join(" ").trim();
}

function clampDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function fmtDay(d) {
  const x = new Date(d);
  const yyyy = String(x.getFullYear());
  const mm = String(x.getMonth() + 1).padStart(2, "0");
  const dd = String(x.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// Get metrics for Super Admin dashboard
const getMetrics = async (req, res) => {
  try {
    if (req.user.role !== "super_admin") {
      return res.status(403).json({ message: "Access forbidden: Super Admin only" });
    }

    const vendorMatch = { role: "vendor_admin", isDeleted: { $ne: true } };

    const [usersCount, formsCount, foldersCount, planCountsAgg, recentVendors] = await Promise.all([
      User.countDocuments(vendorMatch),
      Form.countDocuments(),
      Folder.countDocuments(),
      User.aggregate([
        { $match: vendorMatch },
        {
          $project: {
            plan: {
              $toLower: {
                $ifNull: ["$subscriptionPlan", "free"],
              },
            },
          },
        },
        { $group: { _id: "$plan", count: { $sum: 1 } } },
      ]),
      User.find(vendorMatch)
        .select("firstName lastName email subscriptionPlan createdAt vendorId")
        .sort({ createdAt: -1 })
        .limit(250)
        .lean(),
    ]);

    const planCounts = { free: 0, pro: 0, business: 0 };
    (planCountsAgg || []).forEach((row) => {
      const key = String(row._id || "").toLowerCase();
      if (key === "free" || key === "pro" || key === "business") {
        planCounts[key] = row.count || 0;
      }
    });

    const usersByPlan = { free: [], pro: [], business: [] };
    (recentVendors || []).forEach((u) => {
      const plan = String(u.subscriptionPlan || "free").toLowerCase();
      const safePlan = plan === "pro" || plan === "business" ? plan : "free";
      usersByPlan[safePlan].push({
        id: String(u._id),
        vendorId: u.vendorId || String(u._id),
        name: u.name || toName(u) || "-",
        email: u.email || "-",
        subscriptionPlan: safePlan,
        createdAt: u.createdAt,
      });
    });

    // last 14 days signup series (vendors only), grouped by plan
    const today = clampDay(new Date());
    const start = addDays(today, -13);
    const signupAgg = await User.aggregate([
      { $match: { ...vendorMatch, createdAt: { $gte: start } } },
      {
        $project: {
          day: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          plan: {
            $toLower: {
              $ifNull: ["$subscriptionPlan", "free"],
            },
          },
        },
      },
      { $group: { _id: { day: "$day", plan: "$plan" }, count: { $sum: 1 } } },
    ]);

    const byDay = new Map();
    for (let i = 0; i < 14; i += 1) {
      const day = fmtDay(addDays(start, i));
      byDay.set(day, { day, free: 0, pro: 0, business: 0, total: 0 });
    }
    (signupAgg || []).forEach((row) => {
      const day = row?._id?.day;
      const plan = String(row?._id?.plan || "free").toLowerCase();
      if (!day || !byDay.has(day)) return;
      const safePlan = plan === "pro" || plan === "business" ? plan : "free";
      const obj = byDay.get(day);
      obj[safePlan] += row.count || 0;
      obj.total += row.count || 0;
    });

    return res.json({
      users: usersCount,
      forms: formsCount,
      folders: foldersCount,
      plans: {
        total: planCounts.free + planCounts.pro + planCounts.business,
        counts: planCounts,
      },
      usersByPlan,
      signupSeries: Array.from(byDay.values()),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// Get all users for Super Admin dashboard
const getAllUsers = async (req, res) => {
  try {
    if (req.user.role !== "super_admin") {
      return res.status(403).json({ message: "Access forbidden" });
    }
    const users = await User.find({ role: "vendor_admin", isDeleted: { $ne: true } })
      .sort({ createdAt: -1 })
      .lean();

    return res.json(
      users.map((u) => ({
        ...u,
        name: u.name || toName(u) || "-",
        vendorId: u.vendorId || String(u._id),
      }))
    );
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// Update a vendor_admin user (Super Admin only)
const updateUser = async (req, res) => {
  try {
    if (req.user.role !== "super_admin") {
      return res.status(403).json({ message: "Access forbidden" });
    }
    const { id } = req.params;
    const user = await User.findById(id);
    if (!user) return res.status(404).json({ message: "User not found" });

    const { name, role, vendorId } = req.body || {};
    if (typeof name === "string") {
      const parts = name.trim().split(/\s+/).filter(Boolean);
      user.firstName = parts.shift() || user.firstName;
      user.lastName = parts.join(" ") || user.lastName;
    }
    if (role === "vendor_admin" || role === "super_admin") {
      user.role = role;
    }
    if (typeof vendorId === "string") {
      user.vendorId = vendorId.trim();
    }
    await user.save();

    return res.json({
      ...user.toObject(),
      name: toName(user),
      vendorId: user.vendorId || String(user._id),
    });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(400).json({ message: "Duplicate value" });
    }
    return res.status(500).json({ message: error.message });
  }
};

// Delete a vendor_admin user (Super Admin only)
const deleteUser = async (req, res) => {
  try {
    if (req.user.role !== "super_admin") {
      return res.status(403).json({ message: "Access forbidden" });
    }
    const { id } = req.params;
    const user = await User.findById(id);
    if (!user) return res.status(404).json({ message: "User not found" });
    user.isDeleted = true;
    user.deletedAt = new Date();
    await user.save();
    return res.json({ success: true, softDeleted: true });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// Get all forms for Super Admin dashboard
const getAllForms = async (req, res) => {
  try {
    if (req.user.role !== "super_admin") {
      return res.status(403).json({ message: "Access forbidden" });
    }
    const forms = await Form.find()
      .populate("user", "firstName lastName email role vendorId isDeleted")
      .populate("folderId", "name")
      .sort({ createdAt: -1 })
      .lean();
    return res.json(forms);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

module.exports = { getMetrics, getAllUsers, updateUser, deleteUser, getAllForms };

