const express = require("express");

const app = express();

app.use("/test", (req, res) => {
  res.send("hello form the server !! ");
});

app.get("/user", (req, res) => {
  res.send({
    firstname: "nirmal ",
    lastname: "kandel ",
    status: "user info was sent ",
  });
});
app.post("/user", (req, res) => {
  console.log("save data to the datsabase");
  res.send("data succesfully saved in data base");
});

app.delete("/user", (req, res) => {
  res.send("deleted suceesfully ");
});
app.patch("/user", (req, res) => {
  console.log("patched data is updated   to the datsabase");
  res.send("data succesfully updated in data base");
});

app.listen(7777, () => {
  console.log("server is succesfully listening in port 7777....");
});
