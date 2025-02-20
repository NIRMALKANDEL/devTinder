const express = require("express");

const app = express();

app.use("/test", (req, res) => {
  res.send("hello form the server !! ");
});

app.get("/user ", (req, res) => {
  res.sent({
    firstname: "nirmal ",
    lastname: "kandel ",
    status: "user info was sent ",
  });
});

app.listen(7777, () => {
  console.log("server is succesfully listening in port 7777....");
});
