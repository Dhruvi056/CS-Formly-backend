const Stripe = require("stripe");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
async function check() {
  const sessions = await stripe.checkout.sessions.list({ limit: 1 });
  console.log(JSON.stringify(sessions.data[0], null, 2));
}

check().catch(console.error);
