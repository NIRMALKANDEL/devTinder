const express = require("express");
const requestRouter = express.Router();
const { userAuth } = require("../middlewares/auth");
const { connectionRequest } = require("../models/connectionRequest");
const { User } = require("../models/user");

// Send Connection Request
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

      // Ensure recipient user exists
      const toUser = await User.findById(toUserId);
      if (!toUser) {
        return res.status(404).json({ message: "User not found" });
      }

      // Check if a connection request already exists (in either direction)
      const existingRequest = await connectionRequest.findOne({
        $or: [
          { fromUserId, toUserId },
          { fromUserId: toUserId, toUserId: fromUserId },
        ],
        status: { $in: ["interested", "accepted"] }, // Prevent duplicate active requests
      });

      if (existingRequest) {
        return res
          .status(400)
          .json({ message: "Connection request already exists" });
      }

      // Create new connection request
      const newRequest = new connectionRequest({
        fromUserId,
        toUserId,
        status,
      });

      const savedRequest = await newRequest.save();

      res.status(201).json({
        message: `${req.user.firstName} ${status} ${toUser.firstName}`,
        data: savedRequest,
      });
    } catch (err) {
      console.error("Error in sending request:", err);
      res.status(500).json({ error: "Internal Server Error" });
    }
  }
);

// Review Connection Request (Accept/Reject)
requestRouter.post(
  "/request/review/:status/:requestId",
  userAuth,
  async (req, res) => {
    try {
      const { status, requestId } = req.params;
      const loggedInUser = req.user;

      const allowedStatus = ["accepted", "rejected"];
      if (!allowedStatus.includes(status)) {
        return res.status(400).json({ message: "Invalid status type" });
      }

      const request = await connectionRequest.findOne({
        _id: requestId,
        toUserId: loggedInUser._id,
        status: "interested",
      });

      if (!request) {
        return res
          .status(404)
          .json({ message: "Connection request not found" });
      }

      request.status = status;
      const updatedRequest = await request.save();

      res.json({
        message: `Connection request ${status}`,
        data: updatedRequest,
      });
    } catch (err) {
      console.error("Error in reviewing request:", err);
      res.status(500).json({ error: "Internal Server Error" });
    }
  }
);

module.exports = requestRouter;
