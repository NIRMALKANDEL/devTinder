const express = require("express");
const authRouter = express.Router();
const {
  validateSignUpData,
  validatePasswordData,
} = require("../utils/validation");
const { User } = require("../models/user");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const sendEmail = require("../utils/sendEmail");
const { setAuthCookie, clearAuthCookie } = require("../utils/authCookie");
const { OAuth2Client } = require("google-auth-library");
const {
  loginIpLimiter,
  loginAccountLimiter,
  signupLimiter,
  forgotPasswordLimiter,
} = require("../middlewares/rateLimit");

const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";

// Added: random token for email links; only its hash is stored in the DB
const createToken = () => {
  const token = crypto.randomBytes(32).toString("hex");
  return { token, tokenHash: hashToken(token) };
};
const hashToken = (token) =>
  crypto.createHash("sha256").update(token).digest("hex");

const verifyUrlFor = (token) => `${FRONTEND_URL}/api/verify-email/${token}`;

// Signup API - Create a new user
authRouter.post("/signup", signupLimiter, async (req, res) => {
  try {
    validateSignUpData(req);

    const { password, emailId, firstName, lastName } = req.body;
    const passwordHash = await bcrypt.hash(password, 10);

    const { token, tokenHash } = createToken();

    const user = new User({
      firstName,
      lastName,
      emailId,
      password: passwordHash,
      isEmailVerified: false,
      emailVerificationToken: tokenHash,
    });

    await user.save();

    // Changed: no auto-login; the user must verify their email first
    sendEmail.sendWelcomeEmail(user, verifyUrlFor(token));

    res.status(201).json({
      message:
        "Registered successfully! Please check your email to verify your account.",
    });
  } catch (err) {
    // Changed: short, readable messages instead of the raw MongoDB error
    let message = err.message;
    if (err.code === 11000) {
      message = "An account with this email already exists. Please login.";
    } else if (err.name === "ValidationError") {
      message = Object.values(err.errors)
        .map((e) => e.message)
        .join(" ");
    }
    res.status(400).json({ message });
  }
});

// Added: email verification link (opened from the welcome email).
// Verifying also logs the user in and opens their profile.
authRouter.get("/verify-email/:token", async (req, res) => {
  try {
    const user = await User.findOneAndUpdate(
      { emailVerificationToken: hashToken(req.params.token) },
      {
        $set: { isEmailVerified: true },
        $unset: { emailVerificationToken: 1 },
      }
    );
    if (!user) {
      return res.redirect(`${FRONTEND_URL}/login?verified=false`);
    }

    const token = await user.getJWT();
    setAuthCookie(req, res, token);
    res.redirect(`${FRONTEND_URL}/profile`);
  } catch (err) {
    res.redirect(`${FRONTEND_URL}/login?verified=false`);
  }
});

// Added: forgot password - emails a reset link
authRouter.post("/forgot-password", forgotPasswordLimiter, async (req, res) => {
  try {
    const emailId = String(req.body.emailId || "").toLowerCase().trim();
    const user = await User.findOne({ emailId });

    // Skip if a reset email went out in the last minute: stops email
    // bombing, and keeps the link already sent valid
    if (user && sendEmail.claimPasswordResetEmail(user)) {
      const { token, tokenHash } = createToken();
      try {
        await User.updateOne(
          { _id: user._id },
          {
            $set: {
              passwordResetToken: tokenHash,
              passwordResetExpires: new Date(Date.now() + 15 * 60 * 1000),
            },
          }
        );
      } catch (err) {
        sendEmail.releasePasswordResetEmail(user);
        throw err;
      }
      sendEmail.sendPasswordResetEmail(
        user,
        `${FRONTEND_URL}/reset-password/${token}`
      );
    }

    // Same answer either way, so nobody can check which emails are registered
    res.json({
      message:
        "If an account exists for this email, a password reset link has been sent.",
    });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// Added: reset password using the link from the email
authRouter.post("/reset-password/:token", async (req, res) => {
  try {
    const { password, confirmPassword } = req.body;
    validatePasswordData(password, confirmPassword);

    const user = await User.findOne({
      passwordResetToken: hashToken(req.params.token),
      passwordResetExpires: { $gt: new Date() },
    });
    if (!user) {
      throw new Error("Reset link is invalid or has expired");
    }

    const passwordHash = await bcrypt.hash(password, 10);
    await User.updateOne(
      { _id: user._id },
      {
        // Opening the reset link also proves they own the email.
        // passwordChangedAt logs out every existing session.
        $set: {
          password: passwordHash,
          isEmailVerified: true,
          passwordChangedAt: new Date(),
        },
        $unset: {
          passwordResetToken: 1,
          passwordResetExpires: 1,
          emailVerificationToken: 1,
        },
      }
    );

    res.json({ message: "Password reset successfully. Please login." });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// Login API
authRouter.post("/login", loginIpLimiter, loginAccountLimiter, async (req, res) => {
  try {
    const { emailId, password } = req.body;

    const user = await User.findOne({ emailId });
    if (!user) {
      throw new Error("Invalid credentials");
    }

    const isPasswordValid = await user.validatePassword(password);
    // Added: block login until the email is verified, and send a fresh link
    if (isPasswordValid && user.isEmailVerified === false) {
      // At most one new link per minute, so the earlier link stays valid
      if (sendEmail.claimWelcomeEmail(user)) {
        const { token, tokenHash } = createToken();
        try {
          await User.updateOne(
            { _id: user._id },
            { $set: { emailVerificationToken: tokenHash } }
          );
        } catch (err) {
          sendEmail.releaseWelcomeEmail(user);
          throw err;
        }
        sendEmail.sendWelcomeEmail(user, verifyUrlFor(token));
      }
      throw new Error(
        "Please verify your email first. We've sent you a new verification link."
      );
    }

    if (isPasswordValid) {
      // Set JWT and cookies

      const token = await user.getJWT();
      // console.log(token);

      // Cookie lasts 1 day to match the JWT; secure + sameSite set in authCookie.js
      setAuthCookie(req, res, token);
      res.json({ payload: user });
    } else {
      throw new Error("Invalid credentials");
    }
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// Added: "Continue with Google" (sign up or log in with a Google account).
// GOOGLE_CLIENT_ID is the OAuth web client ID from Google Cloud. It isn't a secret;
// the frontend reads it from /auth/google/config and hides the button when it's unset.
const googleClient = new OAuth2Client();

authRouter.get("/auth/google/config", (req, res) => {
  res.json({ clientId: process.env.GOOGLE_CLIENT_ID || null });
});

// Names must fit the User rules (first name 4-50 characters, last name empty or 2+)
const namesFromGoogle = (p, emailId) => {
  const given = String(p.given_name || "").trim();
  const family = String(p.family_name || "").trim();
  const full = String(p.name || `${given} ${family}`).trim();
  const fits = (v) => v.length >= 4 && v.length <= 50;
  if (fits(given)) return { firstName: given, lastName: family.length >= 2 ? family.slice(0, 50) : "" };
  if (fits(full)) return { firstName: full, lastName: "" };
  const local = emailId.split("@")[0].replace(/[^a-zA-Z0-9 ._-]/g, "").slice(0, 50);
  return { firstName: fits(local) ? local : "Developer", lastName: "" };
};

authRouter.post("/auth/google", loginIpLimiter, async (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return res.status(503).json({ message: "Google sign-in isn't set up yet." });
  }
  let payload;
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: String(req.body?.credential || ""),
      audience: clientId,
    });
    payload = ticket.getPayload();
  } catch (err) {
    return res.status(401).json({ message: "Google sign-in failed. Please try again." });
  }
  if (!payload?.email || payload.email_verified !== true) {
    return res.status(400).json({ message: "Your Google account's email isn't verified." });
  }

  try {
    const emailId = payload.email.toLowerCase().trim();
    let user = await User.findOne({ emailId });
    let isNew = false;

    if (user) {
      // Google has confirmed this email, so a pending email verification is done
      if (user.isEmailVerified === false) {
        await User.updateOne(
          { _id: user._id },
          { $set: { isEmailVerified: true }, $unset: { emailVerificationToken: 1 } }
        );
        user.isEmailVerified = true;
      }
    } else {
      // New account. It gets a random password nobody knows; the user can set
      // one later with "Forgot password" if they also want email login.
      const randomPassword = crypto.randomBytes(24).toString("base64") + "aA1!";
      const { firstName, lastName } = namesFromGoogle(payload, emailId);
      user = new User({
        firstName,
        lastName,
        emailId,
        password: await bcrypt.hash(randomPassword, 10),
        isEmailVerified: true,
        ...(payload.picture ? { photoURL: payload.picture } : {}),
      });
      await user.save();
      isNew = true;
    }

    const token = await user.getJWT();
    setAuthCookie(req, res, token);
    res.status(isNew ? 201 : 200).json({ payload: user, isNew });
  } catch (err) {
    console.error("Google sign-in error:", err.message);
    res.status(400).json({ message: "Couldn't sign you in with Google. Please try again." });
  }
});

// logout API
authRouter.post("/logout", async (req, res) => {
  clearAuthCookie(req, res);
  res.json({ message: "Logged out" });
});
module.exports = authRouter;
