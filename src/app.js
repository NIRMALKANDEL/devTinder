const express = require("express");

const app = express();

const { adminAuth, userAuth } = require("./middlewares/auth");
const { error } = require("console");
app.use("/admin", adminAuth);

app.get("/user", (req, res) => {
  throw new Error("dwdefref");
  res.send("user data sent.. ");
});

app.use("/", (err, req, res, next) => {
  if (err) {
    res.status(500).send("something went wrong !!");
  }
});

// app.post("/user/login", (req, res) => {
//   res.send("user login sucessfully ");
// });

// app.get("/User", userAuth, (req, res) => {
//   res.send("user data sent .....");
// });

// app.get("/admin/getAllData", (req, res) => {
//   // const token = "xyzdcd";
//   // const isAdminAuthorised = token === "xyz";

//   res.send("all data send");
// });
// app.get("/admin/deleteUser", (req, res) => {
//   res.send("deletred user by admin ");
// });

// // app.get("/user", (req, res) => {
// //   console.log(req.query);
// //   res.send({
// //     firstname: "nirmal ",
// //     lastname: "kandel ",
// //     status: "user info was sent ",
// //   });
// // });

app.listen(7777, () => {
  console.log("server is succesfully listening in port 7777....");
});
