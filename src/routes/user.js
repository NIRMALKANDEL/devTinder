const express = require("express");
const { userAuth } = require("../middlewares/auth");
const { connectionRequest } = require("../models/connectionRequest");
const userRouter = express.Router();

const USER_SAFE_DATA = "firstName lastName age photoURL gender about skills";

//get all the pending connection requst for the user
userRouter.get("/user/requests/recieved", userAuth, async (req, res) => {
  try {
    const loggedInUser = req.user;
    const connectionRequests = await connectionRequest
      .find({
        toUserId: loggedInUser._id,
        status: "interested",
      })
      .populate("fromUserId", USER_SAFE_DATA);
    // .populate("fromUserId", ["firstName", "lastName"]);
    res.json({ data: connectionRequests });
  } catch (err) {
    res.status(400).send("ERROR " + err.message);
  }
});

userRouter.get("/user/connections", userAuth, async (req, res) => {
  try {
    const loggedInUser = req.user;
    const connectionRequests = await connectionRequest
      .find({
        $or: [
          { toUserId: loggedInUser._id, status: "accepted" },
          {
            toUserId: loggedInUser._id,
            status: "accepted",
          },
        ],
      })
      .populate("fromUserId", USER_SAFE_DATA);

    const data = connectionRequests.map((row) => row.fromUserId);
    res.json(data);
  } catch (err) {
    res.status(400).send("ERROE " + err.message);
  }
});
module.exports = userRouter;
