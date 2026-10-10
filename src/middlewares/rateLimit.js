const { rateLimit, ipKeyGenerator } = require("express-rate-limit");

// Rate limits for the endpoints that send email or check passwords.
// Keys use req.ip, so app.js must set "trust proxy" to match the real proxy
// chain (nginx behind Cloudflare = 1), or every user shares one bucket.

const limiter = (windowMs, limit, message, options = {}) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { message },
    ...options,
  });

const MINUTE = 60 * 1000;

// Per IP: blocks password guessing from one machine
const loginIpLimiter = limiter(
  15 * MINUTE,
  30,
  "Too many login attempts. Please wait a few minutes and try again."
);

// Per account: only failed logins count, so a real user is never locked out by
// their own successful logins. This one can't be dodged by changing IP.
const loginAccountLimiter = limiter(
  15 * MINUTE,
  10,
  "Too many failed login attempts for this account. Please wait 15 minutes or reset your password.",
  {
    skipSuccessfulRequests: true,
    keyGenerator: (req) =>
      String(req.body?.emailId || "").trim().toLowerCase() || ipKeyGenerator(req.ip),
  }
);

// Every signup sends an email, so keep bots from mass-creating accounts
const signupLimiter = limiter(
  60 * MINUTE,
  10,
  "Too many accounts created from this network. Please try again later."
);

const forgotPasswordLimiter = limiter(
  15 * MINUTE,
  5,
  "Too many password reset requests. Please wait a few minutes and try again."
);

// Generous ceiling for the whole API (stops scripted floods, not normal use)
const apiLimiter = limiter(MINUTE, 300, "Too many requests. Please slow down.");

module.exports = {
  loginIpLimiter,
  loginAccountLimiter,
  signupLimiter,
  forgotPasswordLimiter,
  apiLimiter,
};
