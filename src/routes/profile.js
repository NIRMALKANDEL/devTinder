const express = require("express");
const bcrypt = require("bcryptjs");
const validator = require("validator");

const profileRouter = express.Router();
const { userAuth } = require("../middlewares/auth");
const { validateEditProfileData } = require("../utils/validation");

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
    res.status(400).json({ error: err.message });
  }
});

// ===============================
// PROFILE EDIT API
// ===============================
profileRouter.patch("/profile/edit", userAuth, async (req, res) => {
  try {
    // ✅ Call validation function correctly
    if (!validateEditProfileData(req.body)) {
      throw new Error("INVALID EDIT REQUEST");
    }

    const loggedInUser = req.user;

    // ✅ Allow only safe fields to be updated
    const allowedUpdates = [
      "firstName",
      "lastName",
      "age",
      "photoURL",
      "about",
      "skills",
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
      payload: loggedInUser,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
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
        error: "Old password and new password are required",
      });
    }

    // ✅ Verify old password
    const isMatch = await bcrypt.compare(oldPassword, user.password);
    if (!isMatch) {
      return res.status(400).json({ error: "Old password is incorrect" });
    }

    // ✅ Strong password validation
    if (!validator.isStrongPassword(newPassword)) {
      return res.status(400).json({
        error:
          "Password must be at least 8 characters long and include 1 uppercase letter, 1 number, and 1 special character",
      });
    }

    // ✅ Hash and save new password
    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPassword, salt);

    await user.save();

    res.status(200).json({
      success: true,
      message: "Password updated successfully",
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = profileRouter;
