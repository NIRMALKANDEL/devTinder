const mongoose = require("mongoose");

// Added: one Razorpay order for a Premium purchase. The amount and plan are copied
// from the server's plan config when the order is created (never from the browser),
// so later checks compare Razorpay's data against what we actually asked for.
const paymentSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    orderId: { type: String, required: true, unique: true }, // Razorpay order_...
    receipt: { type: String },
    paymentId: { type: String, index: true }, // Razorpay pay_..., set once known
    amount: { type: Number, required: true }, // in paise
    currency: { type: String, required: true, default: "INR" },
    plan: { type: String, required: true },
    durationDays: { type: Number, required: true },
    mode: { type: String, enum: ["test", "live"], required: true },
    // created -> (authorized) -> paid, or failed. A failed order can still become
    // paid if the user retries inside the same Razorpay checkout.
    status: {
      type: String,
      enum: ["created", "authorized", "paid", "failed"],
      default: "created",
      index: true,
    },
    // Set atomically by the first verify/webhook/reconcile that grants Premium, so a
    // payment can never activate Premium twice
    entitlementGranted: { type: Boolean, default: false },
    failureReason: { type: String },
    paidAt: { type: Date },
    premiumExpiresAt: { type: Date }, // the user's new end date after this payment
  },
  { timestamps: true }
);
paymentSchema.index({ userId: 1, createdAt: -1 });

// Added: Razorpay webhook events already handled (Razorpay retries and may send an
// event more than once). Kept for 90 days.
const webhookEventSchema = new mongoose.Schema({
  eventId: { type: String, required: true, unique: true },
  event: { type: String },
  orderId: { type: String },
  receivedAt: { type: Date, default: Date.now, expires: 90 * 24 * 60 * 60 },
});

const Payment = mongoose.model("Payment", paymentSchema);
const WebhookEvent = mongoose.model("WebhookEvent", webhookEventSchema);
module.exports = { Payment, WebhookEvent };
