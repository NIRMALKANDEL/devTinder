const express = require("express");
const authRouter = express.Router();
const { validateSignUpData } = require("../utils/validation");
const { User } = require("../models/user");
const bcrypt = require("bcryptjs");

// Signup API - Create a new user
authRouter.post("/signup", async (req, res) => {
  try {
    validateSignUpData(req);

    const { password, emailId, firstName, lastName } = req.body;
    const passwordHash = await bcrypt.hash(password, 10);

    console.log(passwordHash);

    const user = new User({
      firstName,
      lastName,
      emailId,
      password: passwordHash,
    });

    await user.save();
    res.send("User added successfully in database!!");
  } catch (err) {
    res.status(400).send(`ERROR:= ${err.message}`);
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
    if (isPasswordValid) {
      // Set JWT and cookies

      const token = await user.getJWT();
      // console.log(token);

      res.cookie("token", token, {
        expires: new Date(Date.now() + 900000),
        httpOnly: true,
      });
      res.send(user);
    } else {
      throw new Error("Invalid credentials");
    }
  } catch (err) {
    res.status(400).send(`ERROR:= ${err.message}`);
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
