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

module.exports = profileRouter;
