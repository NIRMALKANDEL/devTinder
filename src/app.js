const express = require("express");
const { connectDB } = require("./config/Database");
const app = express();
const { User } = require("./models/user");

app.use(express.json());

// Signup API - Create a new user
app.post("/signup", async (req, res) => {
  const user = new User(req.body);
  try {
    await user.save();
    res.send("User added successfully in database!!");
  } catch (err) {
    res
      .status(400)
      .send(`User not added, something went wrong: ${err.message}`);
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
app.patch("/user", async (req, res) => {
  const userId = req.body.userId;
  const data = req.body;
  try {
    const user = await User.findByIdAndUpdate(userId, data, {
      runValidators: true,
      new: true,
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

// const { adminAuth, userAuth } = require("./middlewares/auth");
// const { error } = require("console");
// app.use("/admin", adminAuth);

// app.get("/user", (req, res) => {
//   throw new Error("dwdefref");
//   res.send("user data sent.. ");
// });

// app.use("/", (err, req, res, next) => {
//   if (err) {
//     res.status(500).send("something went wrong !!");
//   }
// });

// // app.post("/user/login", (req, res) => {
// //   res.send("user login sucessfully ");
// // });

// // app.get("/User", userAuth, (req, res) => {
// //   res.send("user data sent .....");
// // });

// // app.get("/admin/getAllData", (req, res) => {
// //   // const token = "xyzdcd";
// //   // const isAdminAuthorised = token === "xyz";

// //   res.send("all data send");
// // });
// // app.get("/admin/deleteUser", (req, res) => {
// //   res.send("deletred user by admin ");
// // });

// // // app.get("/user", (req, res) => {
// // //   console.log(req.query);
// // //   res.send({
// // //     firstname: "nirmal ",
// // //     lastname: "kandel ",
// // //     status: "user info was sent ",
// // //   });
// // // });
