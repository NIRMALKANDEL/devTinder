// Added: Premium plan config and entitlement checks, shared by the payment routes,
// the Premium-only routes and call signaling (src/calls.js).
const { User } = require("../models/user");
const { Payment } = require("../models/payment");
const sendEmail = require("./sendEmail");

const DAY_MS = 24 * 60 * 60 * 1000;

// Price and duration come only from .env. Without a valid price, checkout is off and
// the Premium page says the price still needs confirming.
const getPlan = () => {
  const amount = Number(process.env.PREMIUM_PRICE_PAISE);
  const durationDays = Number(process.env.PREMIUM_DURATION_DAYS || 30);
  const priceConfirmed = Number.isInteger(amount) && amount >= 100; // Razorpay minimum is ₹1
  return {
    id: "premium",
    name: "DevTinder Premium",
    amount: priceConfirmed ? amount : null,
    currency: "INR",
    durationDays: Number.isInteger(durationDays) && durationDays > 0 ? durationDays : 30,
    priceConfirmed,
  };
};

const isPremiumActive = (user) =>
  Boolean(user?.premiumExpiresAt && new Date(user.premiumExpiresAt).getTime() > Date.now());

// Use after userAuth. The check is on the server, so hiding UI is never the only guard.
const requirePremium = (req, res, next) => {
  if (isPremiumActive(req.user)) return next();
  return res.status(403).json({
    message: "This feature is part of DevTinder Premium.",
    code: "PREMIUM_REQUIRED",
  });
};

// Grants Premium for one paid order, exactly once. The first caller (checkout verify,
// webhook or status reconcile) flips entitlementGranted; everyone else gets granted:false.
// The new end date is computed inside MongoDB, so two payments at the same moment
// both add their days (an active plan is extended, an expired one restarts from now).
const grantPremium = async (orderId, { paymentId } = {}) => {
  const payment = await Payment.findOneAndUpdate(
    { orderId, entitlementGranted: false },
    {
      $set: {
        status: "paid",
        entitlementGranted: true,
        paidAt: new Date(),
        ...(paymentId ? { paymentId } : {}),
      },
    },
    { new: true }
  );
  if (!payment) {
    return { granted: false, payment: await Payment.findOne({ orderId }) };
  }

  try {
    const user = await User.findOneAndUpdate(
      { _id: payment.userId },
      [
        {
          $set: {
            premiumExpiresAt: {
              $add: [
                {
                  $cond: [
                    { $gt: ["$premiumExpiresAt", "$$NOW"] },
                    "$premiumExpiresAt",
                    "$$NOW",
                  ],
                },
                payment.durationDays * DAY_MS,
              ],
            },
          },
        },
      ],
      { new: true }
    ).select("premiumExpiresAt firstName emailId");

    if (!user) {
      // Account deleted after paying: keep the record for refunds/support
      console.error(`[payment] order ${orderId} paid but user ${payment.userId} no longer exists`);
      return { granted: false, payment };
    }
    payment.premiumExpiresAt = user.premiumExpiresAt;
    await payment.save();
    sendEmail.sendPremiumActivatedEmail(user, payment); // queued; never throws
    return { granted: true, payment, premiumExpiresAt: user.premiumExpiresAt };
  } catch (err) {
    // Release the claim so a retry (webhook, status check) can grant it
    await Payment.updateOne({ _id: payment._id }, { $set: { entitlementGranted: false } });
    throw err;
  }
};

module.exports = { getPlan, isPremiumActive, requirePremium, grantPremium, DAY_MS };
