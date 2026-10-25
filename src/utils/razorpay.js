// Added: small Razorpay client (Orders API, Payments API, signatures) using Node's
// built-in fetch and crypto, so no extra npm package is needed.
// Keys come only from the server's .env and are never sent to the browser except
// the public key id, which Razorpay Checkout needs.
const crypto = require("crypto");

const API_URL = "https://api.razorpay.com/v1";

const isConfigured = () =>
  Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);

// "test" for rzp_test_ keys, otherwise "live"
const mode = () => (String(process.env.RAZORPAY_KEY_ID || "").startsWith("rzp_live_") ? "live" : "test");

const request = async (method, path, body) => {
  const auth = Buffer.from(
    `${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`
  ).toString("base64");
  const res = await fetch(API_URL + path, {
    method,
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.error?.description || `Razorpay request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
};

// amount is in paise
const createOrder = ({ amount, currency, receipt, notes }) =>
  request("POST", "/orders", { amount, currency, receipt, notes });

const fetchPayment = (paymentId) => request("GET", `/payments/${encodeURIComponent(paymentId)}`);

const fetchOrderPayments = (orderId) =>
  request("GET", `/orders/${encodeURIComponent(orderId)}/payments`);

const hmacHex = (data, secret) => crypto.createHmac("sha256", secret).update(data).digest("hex");

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a || ""));
  const y = Buffer.from(String(b || ""));
  return x.length > 0 && x.length === y.length && crypto.timingSafeEqual(x, y);
};

// Checkout success handler signature: HMAC_SHA256(order_id + "|" + payment_id, key_secret)
const verifyPaymentSignature = ({ orderId, paymentId, signature }) =>
  Boolean(process.env.RAZORPAY_KEY_SECRET) &&
  safeEqual(hmacHex(`${orderId}|${paymentId}`, process.env.RAZORPAY_KEY_SECRET), signature);

// Webhook signature: HMAC_SHA256(raw request body, webhook secret)
const verifyWebhookSignature = (rawBody, signature) =>
  Boolean(process.env.RAZORPAY_WEBHOOK_SECRET) &&
  safeEqual(hmacHex(rawBody, process.env.RAZORPAY_WEBHOOK_SECRET), signature);

module.exports = {
  isConfigured,
  mode,
  createOrder,
  fetchPayment,
  fetchOrderPayments,
  verifyPaymentSignature,
  verifyWebhookSignature,
  hmacHex,
};
