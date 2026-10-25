// Added: Premium purchase with Razorpay Standard Checkout.
//   1. POST /payment/create-order  -> server creates a Razorpay order for the server-side price
//   2. Browser opens Razorpay Checkout with that order id
//   3. POST /payment/verify         -> server checks the signature AND asks Razorpay that the
//                                      payment is captured for the right order and amount
//   4. POST /payment/webhook        -> Razorpay tells us about captured/failed/paid events
//                                      (covers closed tabs and pending payments)
// Premium is granted only in grantPremium (utils/premium.js), exactly once per order.
const express = require("express");
const { userAuth } = require("../middlewares/auth");
const { paymentLimiter, paymentStatusLimiter } = require("../middlewares/rateLimit");
const { Payment, WebhookEvent } = require("../models/payment");
const { User } = require("../models/user");
const razorpay = require("../utils/razorpay");
const { getPlan, grantPremium, isPremiumActive } = require("../utils/premium");

const paymentRouter = express.Router();

const ORDER_ID = /^order_[A-Za-z0-9]{6,40}$/;
const PAYMENT_ID = /^pay_[A-Za-z0-9]{6,40}$/;
const SIGNATURE = /^[a-f0-9]{64}$/;
// An unpaid order younger than this is reused instead of creating another one
const REUSE_ORDER_MS = 15 * 60 * 1000;

// Users with an order being created right now (stops double-click duplicates)
const creating = new Set();

const checkoutEnabled = () => razorpay.isConfigured() && getPlan().priceConfirmed;

const publicStatus = (payment, user) => ({
  orderId: payment.orderId,
  status: payment.status,
  premiumActivated: payment.entitlementGranted,
  premiumExpiresAt: user?.premiumExpiresAt || payment.premiumExpiresAt || null,
  isPremium: user ? isPremiumActive(user) : undefined,
});

const reloadUser = (req) => User.findById(req.user._id).select("premiumExpiresAt");

// Compares what Razorpay reports with the order we created
const matchesOrder = (payment, rp) =>
  rp &&
  rp.order_id === payment.orderId &&
  Number(rp.amount) === payment.amount &&
  rp.currency === payment.currency;

// Applies one Razorpay payment entity to our record. Returns the new status.
const applyRazorpayPayment = async (payment, rp) => {
  if (!matchesOrder(payment, rp)) {
    console.error(`[payment] mismatch for ${payment.orderId}: got ${rp?.order_id} ${rp?.amount} ${rp?.currency}`);
    return payment.status;
  }
  if (rp.status === "captured") {
    await grantPremium(payment.orderId, { paymentId: rp.id });
    return "paid";
  }
  if (payment.entitlementGranted) return "paid";
  if (rp.status === "authorized") {
    await Payment.updateOne(
      { _id: payment._id, entitlementGranted: false },
      { $set: { status: "authorized", paymentId: rp.id } }
    );
    return "authorized";
  }
  if (rp.status === "failed") {
    await Payment.updateOne(
      { _id: payment._id, entitlementGranted: false },
      { $set: { status: "failed", paymentId: rp.id, failureReason: String(rp.error_description || "").slice(0, 300) } }
    );
    return "failed";
  }
  return payment.status;
};

// ---------------------------------------------------------------------------
// Create an order. The amount always comes from the server's plan config.
// ---------------------------------------------------------------------------
paymentRouter.post("/payment/create-order", userAuth, paymentLimiter, async (req, res) => {
  const userKey = String(req.user._id);
  if (!checkoutEnabled()) {
    return res.status(503).json({ message: "Premium checkout is not available yet." });
  }
  if (creating.has(userKey)) {
    return res.status(409).json({ message: "Your order is already being created. Please wait." });
  }
  creating.add(userKey);
  try {
    const plan = getPlan();
    const mode = razorpay.mode();

    // Reuse a recent unpaid order for the same plan and price (retries, refreshes)
    let payment = await Payment.findOne({
      userId: req.user._id,
      status: "created",
      amount: plan.amount,
      durationDays: plan.durationDays,
      mode,
      createdAt: { $gt: new Date(Date.now() - REUSE_ORDER_MS) },
    }).sort({ createdAt: -1 });

    if (!payment) {
      const receipt = `dt_${userKey.slice(-10)}_${Date.now()}`;
      const order = await razorpay.createOrder({
        amount: plan.amount,
        currency: plan.currency,
        receipt,
        notes: { userId: userKey, plan: plan.id, durationDays: String(plan.durationDays) },
      });
      payment = await Payment.create({
        userId: req.user._id,
        orderId: order.id,
        receipt,
        amount: order.amount,
        currency: order.currency,
        plan: plan.id,
        durationDays: plan.durationDays,
        mode,
      });
    }

    res.status(201).json({
      data: {
        orderId: payment.orderId,
        amount: payment.amount,
        currency: payment.currency,
        keyId: process.env.RAZORPAY_KEY_ID, // public key id, safe for the browser
        name: plan.name,
        description: `${plan.durationDays} days of Premium`,
        mode,
        prefill: {
          name: [req.user.firstName, req.user.lastName].filter(Boolean).join(" "),
          email: req.user.emailId,
        },
      },
    });
  } catch (err) {
    console.error("[payment] create-order failed:", err.message);
    res.status(502).json({ message: "Couldn't start the payment. Please try again in a moment." });
  } finally {
    creating.delete(userKey);
  }
});

// ---------------------------------------------------------------------------
// Verify the checkout result. Signature first, then Razorpay's own record.
// ---------------------------------------------------------------------------
paymentRouter.post("/payment/verify", userAuth, paymentLimiter, async (req, res) => {
  try {
    const orderId = String(req.body?.razorpay_order_id || "");
    const paymentId = String(req.body?.razorpay_payment_id || "");
    const signature = String(req.body?.razorpay_signature || "");
    if (!ORDER_ID.test(orderId) || !PAYMENT_ID.test(paymentId) || !SIGNATURE.test(signature)) {
      return res.status(400).json({ message: "Invalid payment details." });
    }

    const payment = await Payment.findOne({ orderId, userId: req.user._id });
    if (!payment) return res.status(404).json({ message: "Order not found." });

    if (payment.entitlementGranted) {
      return res.json({ message: "Premium is active.", data: publicStatus(payment, await reloadUser(req)) });
    }

    if (!razorpay.verifyPaymentSignature({ orderId, paymentId, signature })) {
      console.error(`[payment] bad checkout signature for ${orderId} (user ${req.user._id})`);
      return res.status(400).json({ message: "We couldn't verify this payment. If money was deducted, contact support." });
    }

    let status;
    try {
      status = await applyRazorpayPayment(payment, await razorpay.fetchPayment(paymentId));
    } catch (err) {
      // Razorpay unreachable: don't fail the user; the webhook or a status check finishes it
      console.error(`[payment] fetch payment ${paymentId} failed:`, err.message);
      status = "pending";
    }

    const fresh = await Payment.findById(payment._id);
    const user = await reloadUser(req);
    if (fresh.entitlementGranted) {
      return res.json({ message: "Payment successful. Premium is active.", data: publicStatus(fresh, user) });
    }
    if (status === "failed") {
      return res.status(402).json({ message: "The payment failed. No Premium was added. You can try again.", data: publicStatus(fresh, user) });
    }
    return res.status(202).json({
      message: "Payment received. We're confirming it with the bank; Premium activates as soon as it's confirmed.",
      data: { ...publicStatus(fresh, user), status: "pending" },
    });
  } catch (err) {
    console.error("[payment] verify failed:", err.message);
    res.status(500).json({ message: "Something went wrong while confirming your payment. Please check again in a minute." });
  }
});

// ---------------------------------------------------------------------------
// Status of one order (polled while pending). If it's not settled yet, asks Razorpay,
// so Premium still activates when webhooks aren't set up or were missed.
// ---------------------------------------------------------------------------
paymentRouter.get("/payment/status/:orderId", userAuth, paymentStatusLimiter, async (req, res) => {
  try {
    const { orderId } = req.params;
    if (!ORDER_ID.test(orderId)) return res.status(400).json({ message: "Invalid order." });
    let payment = await Payment.findOne({ orderId, userId: req.user._id });
    if (!payment) return res.status(404).json({ message: "Order not found." });

    if (!payment.entitlementGranted && razorpay.isConfigured()) {
      try {
        const list = await razorpay.fetchOrderPayments(orderId);
        const items = list?.items || [];
        const captured = items.find((p) => p.status === "captured");
        const latest = captured || items.sort((a, b) => b.created_at - a.created_at)[0];
        if (latest) await applyRazorpayPayment(payment, latest);
        payment = await Payment.findById(payment._id);
      } catch (err) {
        console.error(`[payment] status reconcile ${orderId} failed:`, err.message);
      }
    }
    res.json({ data: publicStatus(payment, await reloadUser(req)) });
  } catch (err) {
    console.error("[payment] status failed:", err.message);
    res.status(500).json({ message: "Couldn't check the payment status." });
  }
});

// ---------------------------------------------------------------------------
// Webhook. Mounted in app.js with express.raw BEFORE express.json, because the
// signature is computed over the exact raw body.
// ---------------------------------------------------------------------------
const webhookHandler = async (req, res) => {
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
  const signature = req.get("x-razorpay-signature");
  if (!razorpay.verifyWebhookSignature(raw, signature)) {
    return res.status(400).json({ message: "Invalid signature" });
  }

  let body;
  try {
    body = JSON.parse(raw.toString("utf8"));
  } catch {
    return res.status(400).json({ message: "Invalid JSON" });
  }

  const event = String(body.event || "");
  const rp = body.payload?.payment?.entity;
  const orderId = rp?.order_id || body.payload?.order?.entity?.id;
  // Razorpay sends a unique id per event; retries reuse it
  const eventId =
    req.get("x-razorpay-event-id") ||
    `${event}:${rp?.id || orderId || "none"}:${body.created_at || ""}`;

  try {
    await WebhookEvent.create({ eventId, event, orderId });
  } catch (err) {
    if (err.code === 11000) return res.json({ status: "duplicate" });
    console.error("[payment] webhook store failed:", err.message);
    return res.status(500).json({ message: "retry" });
  }

  try {
    const handled = ["payment.captured", "payment.authorized", "payment.failed", "order.paid"];
    if (handled.includes(event) && orderId) {
      const payment = await Payment.findOne({ orderId });
      if (payment && rp) {
        await applyRazorpayPayment(payment, rp);
      } else if (!payment) {
        console.error(`[payment] webhook ${event} for unknown order ${orderId}`);
      }
    }
    res.json({ status: "ok" });
  } catch (err) {
    // Forget the event so Razorpay's retry is processed again
    await WebhookEvent.deleteOne({ eventId }).catch(() => {});
    console.error(`[payment] webhook ${event} failed:`, err.message);
    res.status(500).json({ message: "retry" });
  }
};

module.exports = paymentRouter;
module.exports.webhookHandler = webhookHandler;
module.exports.checkoutEnabled = checkoutEnabled;
