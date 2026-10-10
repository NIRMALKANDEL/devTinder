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
authRouter.post("/signup", async (req, res) => {
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
    res.status(400).send(`ERROR:= ${message}`);
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
    res.cookie("token", token, {
      expires: new Date(Date.now() + 24 * 60 * 60 * 1000),
      httpOnly: true,
    });
    res.redirect(`${FRONTEND_URL}/profile`);
  } catch (err) {
    res.redirect(`${FRONTEND_URL}/login?verified=false`);
  }
});

// Added: forgot password - emails a reset link
authRouter.post("/forgot-password", async (req, res) => {
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
        // Opening the reset link also proves they own the email
        $set: { password: passwordHash, isEmailVerified: true },
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
authRouter.post("/login", async (req, res) => {
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

      // Changed: cookie now lasts 1 day to match the JWT so refresh keeps the user logged in
      res.cookie("token", token, {
        expires: new Date(Date.now() + 24 * 60 * 60 * 1000),
        httpOnly: true,
      });
      res.json({ payload: user });
    } else {
      throw new Error("Invalid credentials");
    }
  } catch (err) {
    res.status(400).send(`Error  ${err.message}`);
  }
});

// logout API
authRouter.post("/logout", async (req, res) => {
  res.cookie("token", null, {
    expires: new Date(0),
  });
  res.send("Logout Sucessfull ");
});
module.exports = authRouter;
