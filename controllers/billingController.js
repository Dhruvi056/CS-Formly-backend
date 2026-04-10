const User = require("../models/userModel");
const { getUsageSnapshot } = require("../utils/planUsage");

let stripeSingleton = null;
function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  if (!stripeSingleton) {
    const Stripe = require("stripe");
    stripeSingleton = new Stripe(key);
  }
  return stripeSingleton;
}

const PLAN_TO_ENV_PRICE = {
  pro: "STRIPE_PRICE_PRO",
  business: "STRIPE_PRICE_BUSINESS",
};

function getFrontendUrl() {
  return (
    process.env.FRONTEND_URL ||
    process.env.CLIENT_URL ||
    "http://localhost:3001"
  ).replace(/\/$/, "");
}

async function applyPlanFromSession(session) {
  const userId = session.metadata?.userId;
  const plan = session.metadata?.plan;
  if (!userId || !plan || !["pro", "business"].includes(plan)) return;
  const paid =
    session.payment_status === "paid" ||
    session.status === "complete" ||
    session.payment_status === "no_payment_required";
  if (!paid) return;

  await User.findByIdAndUpdate(userId, {
    subscriptionPlan: plan,
    ...(session.customer && typeof session.customer === "string"
      ? { stripeCustomerId: session.customer }
      : {}),
  });
}

/**
 * POST /api/billing/create-checkout-session
 * Body: { plan: "pro" | "business" }
 */
const createCheckoutSession = async (req, res) => {
  try {
    const stripe = getStripe();
    if (!stripe) {
      return res.status(503).json({
        error:
          "Stripe is not configured. Set STRIPE_SECRET_KEY and price IDs in .env",
      });
    }

    const plan = String(req.body?.plan || "").toLowerCase();
    if (plan !== "pro" && plan !== "business") {
      return res.status(400).json({ error: "plan must be pro or business" });
    }

    const envName = PLAN_TO_ENV_PRICE[plan];
    const priceId = process.env[envName];
    if (!priceId) {
      return res.status(503).json({
        error: `Missing ${envName} in environment (Stripe Price ID for ${plan})`,
      });
    }

    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ error: "User not found" });

    // Accounts V2: Checkout in test mode requires an existing Customer (not only customer_email).
    let stripeCustomerId = user.stripeCustomerId;
    if (stripeCustomerId) {
      try {
        await stripe.customers.retrieve(stripeCustomerId);
      } catch {
        stripeCustomerId = "";
      }
    }
    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { userId: String(user._id) },
      });
      stripeCustomerId = customer.id;
      user.stripeCustomerId = customer.id;
      await user.save();
    }

    const base = getFrontendUrl();
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${base}/pricing?success=1&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/pricing?canceled=1`,
      customer: stripeCustomerId,
      client_reference_id: String(user._id),
      metadata: {
        userId: String(user._id),
        plan,
      },
      subscription_data: {
        metadata: {
          userId: String(user._id),
          plan,
        },
      },
    });

    if (!session.url) {
      return res.status(500).json({ error: "Stripe did not return a checkout URL" });
    }

    return res.json({ url: session.url });
  } catch (err) {
    console.error("createCheckoutSession", err);
    return res.status(500).json({ error: err.message || "Checkout failed" });
  }
};

/**
 * GET /api/billing/complete-session?session_id=...
 * Confirms payment after redirect (in addition to webhook).
 */
const completeCheckoutSession = async (req, res) => {
  try {
    const stripe = getStripe();
    if (!stripe) {
      return res.status(503).json({ error: "Stripe is not configured" });
    }

    const sessionId = String(req.query.session_id || "").trim();
    if (!sessionId) {
      return res.status(400).json({ error: "session_id is required" });
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.metadata?.userId !== String(req.user._id)) {
      return res.status(403).json({ error: "Session does not belong to this user" });
    }

    await applyPlanFromSession(session);

    const user = await User.findById(req.user._id).select("-password");
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
  } catch (err) {
    console.error("completeCheckoutSession", err);
    return res.status(500).json({ error: err.message || "Could not complete session" });
  }
};

/**
 * POST /api/billing/webhook — raw body (registered in server.js before express.json)
 */
const handleStripeWebhook = async (req, res) => {
  const stripe = getStripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!stripe || !secret) {
    console.warn("Stripe webhook: missing STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET");
    return res.status(503).send("Webhook not configured");
  }

  let event;
  try {
    const sig = req.headers["stripe-signature"];
    event = stripe.webhooks.constructEvent(req.body, sig, secret);
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    const type = event.type;
    if (type === "checkout.session.completed") {
      const session = event.data.object;
      await applyPlanFromSession(session);
    }
  } catch (e) {
    console.error("Webhook handler error:", e);
    return res.status(500).json({ error: e.message });
  }

  return res.json({ received: true });
};

const getUsage = async (req, res) => {
  try {
    const snap = await getUsageSnapshot(req.user._id);
    if (!snap) return res.status(404).json({ error: "User not found" });
    return res.json(snap);
  } catch (err) {
    console.error("getUsage", err);
    return res.status(500).json({ error: err.message || "Failed to load usage" });
  }
};

module.exports = {
  createCheckoutSession,
  completeCheckoutSession,
  handleStripeWebhook,
  getUsage,
};
