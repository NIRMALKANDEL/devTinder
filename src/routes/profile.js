const express = require("express");
const bcrypt = require("bcryptjs");
const validator = require("validator");

const profileRouter = express.Router();
const { userAuth } = require("../middlewares/auth");
const { validateEditProfileData } = require("../utils/validation");
const { setAuthCookie, clearAuthCookie } = require("../utils/authCookie");
const { User } = require("../models/user");
const { connectionRequest } = require("../models/connectionRequest");
const { Report } = require("../models/report");
const { Chat, Message } = require("../models/chat");

// ===============================
// PROFILE VIEW API
// ===============================
profileRouter.get("/profile/view", userAuth, async (req, res) => {
  try {
    res.status(200).json({
      success: true,
      payload: req.user,
    });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// ===============================
// PROFILE EDIT API
// ===============================
profileRouter.patch("/profile/edit", userAuth, async (req, res) => {
  try {
    // ✅ Call validation function correctly
    if (!validateEditProfileData(req)) {
      throw new Error("INVALID EDIT REQUEST");
    }

    const loggedInUser = req.user;

    // ✅ Allow only safe fields to be updated
    const allowedUpdates = [
      "firstName",
      "lastName",
      "age",
      "gender",
      "photoURL",
      "about",
      "skills",
      "portfolioUrl", // Added: persist the portfolio website URL
      "githubUrl", // Added: persist the GitHub profile URL
    ];

    allowedUpdates.forEach((key) => {
      if (req.body[key] !== undefined) {
        loggedInUser[key] = req.body[key];
      }
    });

    await loggedInUser.save();

    res.status(200).json({
      success: true,
      message: `${loggedInUser.firstName}, your profile is edited successfully`,
      data: loggedInUser,
    });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// ===============================
// CHANGE PASSWORD API
// ===============================
profileRouter.put("/profile/password", userAuth, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    const user = req.user;

    if (!oldPassword || !newPassword) {
      return res.status(400).json({
        message: "Old password and new password are required",
      });
    }

    // ✅ Verify old password
    const isMatch = await bcrypt.compare(oldPassword, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: "Old password is incorrect" });
    }

    // ✅ Strong password validation
    if (!validator.isStrongPassword(newPassword)) {
      return res.status(400).json({
        message:
          "Password must be at least 8 characters long and include 1 uppercase letter, 1 number, and 1 special character",
      });
    }

    // ✅ Hash and save new password
    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPassword, salt);
    // Added: log out other sessions, then give this browser a fresh token
    user.passwordChangedAt = new Date();

    await user.save();
    setAuthCookie(req, res, await user.getJWT());

    res.status(200).json({
      success: true,
      message: "Password updated successfully",
    });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// ===============================
// DELETE ACCOUNT API (Added)
// ===============================
// Needs the password again. Removes the user and everything tied to them:
// requests, chats and messages, reports they filed, and their place in other
// users' block lists. Reports filed against them are kept for moderation.
profileRouter.delete("/profile", userAuth, async (req, res) => {
  try {
    const { password } = req.body || {};
    const user = req.user;
    if (!password || !(await user.validatePassword(password))) {
      return res.status(400).json({ message: "Password is incorrect" });
    }

    const chats = await Chat.find({ participants: user._id }).select("_id");
    const chatIds = chats.map((c) => c._id);
    await Promise.all([
      connectionRequest.deleteMany({
        $or: [{ fromUserId: user._id }, { toUserId: user._id }],
      }),
      Message.deleteMany({ chatId: { $in: chatIds } }),
      Chat.deleteMany({ _id: { $in: chatIds } }),
      Report.deleteMany({ reporterId: user._id }),
      User.updateMany({ blockedUsers: user._id }, { $pull: { blockedUsers: user._id } }),
    ]);
    await User.deleteOne({ _id: user._id });

    clearAuthCookie(req, res);
    res.json({ message: "Your account has been deleted." });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

module.exports = profileRouter;
