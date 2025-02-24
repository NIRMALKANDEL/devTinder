const express = require("express");
const { connectDB } = require("./config/Database");
const app = express();
const { User } = require("./models/user");
const { validateSignUpData } = require("./utils/validation");
const bcrypt = require("bcryptjs");

app.use(express.json());

// Signup API - Create a new user
app.post("/signup", async (req, res) => {
  try {
    // validating  the data
    validateSignUpData(req);

    //encrypt the password
    const { password, emailId, firstName, lastName } = req.body;
    const passwordHash = await bcrypt.hash(password, 10);

    console.log(passwordHash);
    // creating the  user
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

//login post
app.post("/login", async (req, res) => {
  try {
    const { emailId, password } = req.body;

    const user = await User.findOne({ emailId: emailId });
    if (!user) {
      throw new Error(" invalid cridentails");
    }
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (isPasswordValid) {
      res.send("Login Successfull");
    } else {
      throw new Error("invaild cridential");
    }
  } catch (err) {
    res.status(400).send(`ERROR:= ${err.message}`);
  }
});

// Get a user by email
app.get("/user", async (req, res) => {
  const userEmail = req.body.emailId;
  try {
    const users = await User.findOne({ emailId: userEmail });
    if (!users) {
      res.status(404).send("User not found!!");
    } else {
      res.send(users);
    }
  } catch (err) {
    res.status(404).send(`Something went wrong: ${err.message}`);
  }
});

// Get all users (feed API)
app.get("/feed", async (req, res) => {
  try {
    const users = await User.find({});
    res.send(users);
  } catch (err) {
    res.status(404).send(`Something went wrong: ${err.message}`);
  }
});

// Delete a user by ID
app.delete("/user", async (req, res) => {
  const userId = req.body.userId;
  try {
    await User.findByIdAndDelete(userId);
    res.send("User deleted successfully");
  } catch (err) {
    res
      .status(404)
      .send(`User not found, something went wrong: ${err.message}`);
  }
});

// Update a user by ID
app.patch("/user/:userId", async (req, res) => {
  const userId = req.params?.userId;
  const data = req.body;

  try {
    const allowedUpdates = [
      "firstName",
      "lastName",
      "password",
      "skills",
      "photoURL",
      "age",
      "gender",
      "about",
    ];
    const isUpdateAllowed = Object.keys(data).every((key) =>
      allowedUpdates.includes(key)
    );

    if (!isUpdateAllowed) {
      return res.status(400).send("Update contains invalid fields");
    }

    if (data.skills && data?.skills.length > 10) {
      throw new Error("skills cannot be more than 10");
    }
    const user = await User.findByIdAndUpdate(userId, data, {
      runValidators: true,
      new: true,
      context: "query",
    });

    if (!user) {
      res.status(404).send("User not found");
    } else {
      res.send("User updated successfully");
    }
  } catch (err) {
    res.status(400).send(`User update failed: ${err.message}`);
  }
});

// Connect to database and start server
connectDB()
  .then(() => {
    console.log("Database connection established");
    app.listen(7777, () => {
      console.log("Server is successfully listening on port 7777...");
    });
  })
  .catch((err) => {
    console.error("Database connection failed: ", err.message);
  });
