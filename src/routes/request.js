const express = require("express");
const requestRouter = express.Router();
const { userAuth } = require("../middlewares/auth");
const { connectionRequestModel } = require("../models/connectionRequest");
const { User } = require("../models/user");

requestRouter.post(
  "/request/send/:status/:toUserId",
  userAuth,
  async (req, res) => {
    try {
      const fromUserId = req.user._id;
      const toUserId = req.params.toUserId;
      const status = req.params.status.toLowerCase();

      const allowedStatus = ["ignored", "interested"];
      if (!allowedStatus.includes(status)) {
        return res
          .status(400)
          .json({ message: `Invalid status type: ${status}` });
      }

      // Ensure toUserId is valid
      const toUser = await User.findById(toUserId);
      if (!toUser) {
        return res.status(404).json({ message: "User not found" });
      }

      // Check if a connection request already exists
      const existingRequest = await connectionRequestModel.findOne({
        $or: [
          { fromUserId, toUserId },
          { fromUserId: toUserId, toUserId: fromUserId },
        ],
        status: { $in: ["interested", "accepted"] }, // Avoid resending active requests
      });

      if (existingRequest) {
        return res
          .status(400)
          .json({ message: "Connection request already exists" });
      }

      // Create new connection request
      const newRequest = new connectionRequestModel({
        fromUserId,
        toUserId,
        status,
      });

      const savedRequest = await newRequest.save();

      res.status(201).json({
        message: req.user.firstName + status + toUser.firstName,
        data: savedRequest,
      });
    } catch (err) {
      console.error("Error in sending request:", err);
      res.status(500).json({ error: "Internal Server Error" });
    }
  }
);

module.exports = requestRouter;
