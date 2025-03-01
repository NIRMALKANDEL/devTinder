const express = require("express");
const profileRouter = express.Router();
const { userAuth } = require("../middlewares/auth");
const { validateEditProfileData } = require("../utils/validation");

// Profile API - Reading Cookies
profileRouter.get("/profile/view", userAuth, async (req, res) => {
  try {
    const user = req.user;
    res.send(user);
    console.log(user);
  } catch (err) {
    res.status(400).send(err.message);
  }
});

// profile edit api
profileRouter.patch("/profile/edit", userAuth, async (req, res) => {
  try {
    if (!validateEditProfileData) {
      throw new Error("INVALID EDIT REQUEST");
    }
    const loggedInUser = req.user;
    Object.keys(req.body).forEach((key) => (loggedInUser[key] = req.body[key]));

    await loggedInUser.save();
    res.json({
      message: `${loggedInUser.firstName},your profile is edited succesfully`,
      data: loggedInUser,
    });
  } catch (err) {
    res.status(400).send("ERROE :- " + err.message);
  }
});

// EDIT _PASSWARD API
profileRouter.put("/profile/password", userAuth, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    const user = req.user;

    // Check if old password matches
    const isMatch = await bcrypt.compare(oldPassword, user.password);
    if (!isMatch) {
      return res.status(400).json({ error: "Old password is incorrect" });
    }

    // Validate new password using validator
    if (!validator.isStrongPassword(newPassword)) {
      return res.status(400).json({
        error:
          "Password must be at least 8 characters long, include 1 uppercase letter, 1 number, and 1 special character.",
      });
    }

    // Hash new password
    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPassword, salt);

    // Save updated user data
    await user.save();
    res.json({ message: "Password updated successfully" });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = profileRouter;
