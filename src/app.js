const express = require("express");
const { connectDB } = require("./config/Database");
const app = express();
const { User } = require("./models/user");

app.use(express.json());
// this is the post api which push the signup data
app.post("/signup", async (req, res) => {
  // reading the request

  //creating a new instance of the user model
  const user = new User(req.body);
  try {
    await user.save();
    res.send("user added succesfully in database!!");
  } catch (err) {
    res.status(401).send("user not added somethinf went wrong");
  }
});

// finding one  user
app.get("/user", async (req, res) => {
  const userEmail = req.body.emailId;
  try {
    const users = await User.findOne({ emailId: userEmail });
    if (!users) {
      res.status(404).send("something went wronmg!!");
    } else {
      res.send(users);
    }
  } catch (err) {
    res.status(404).send("something went wronmg!!");
  }
});

// Freed API -  GET feed from the data of all the users in the database
app.get("/feed", async (req, res) => {
  try {
    const users = await User.find({});
    res.send(users);
  } catch (err) {
    res.status(404).send("something went wronmg!!");
  }
});

// dedletr the user API

app.delete("/user", async (req, res) => {
  const userId = req.body.userId;
  try {
    const user = await User.findByIdAndDelete(userId);
    res.send("user deleted successfully");
  } catch (err) {
    res.status(404).send("USeR not found  something went wrong");
  }
});

// update the data of the user

app.patch("/user", async (req, res) => {
  const userId = req.body.userId;
  const data = req.body;
  try {
    const user = await User.findByIdAndUpdate(userId, data);
    res.send("user Updated  successfully");
  } catch (err) {
    res.status(404).send("USeR not found  something went wrong");
  }
});

connectDB()
  .then(() => {
    console.log("database connection established ");

    app.listen(7777, () => {
      console.log("server is succesfully listening in port 7777....");
    });
  })
  .catch((err) => {
    console.error("database cannot be connected ");
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
