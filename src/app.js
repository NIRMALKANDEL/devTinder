const express = require("express");

const app = express();

app.use("/", (req, res) => {
  res.send("hello form the dashboard  !! ");
});

app.use("/test", (req, res) => {
  res.send("hello form the server !! ");
});

app.use("/hello", (req, res) => {
  res.send("hello hello hello!! ");
});

app.listen(7777, () => {
  console.log("server is succesfully listening in port 7777....");
});
