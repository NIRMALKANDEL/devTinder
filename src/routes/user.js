const express = require("express");
const mongoose = require("mongoose");
const { userAuth } = require("../middlewares/auth");
const { connectionRequest } = require("../models/connectionRequest");
const { User } = require("../models/user");
const { Report, REPORT_REASONS } = require("../models/report");
const { blockedIdsFor } = require("../utils/relations");
const sendEmail = require("../utils/sendEmail");
const userRouter = express.Router();

// Added: include portfolioUrl / githubUrl so feed/connection cards can show the links
const USER_SAFE_DATA =
  "firstName lastName age photoURL gender about skills portfolioUrl githubUrl";

const isId = (id) => mongoose.isValidObjectId(id);

// Get all pending connection requests for the user
userRouter.get("/user/requests/received", userAuth, async (req, res) => {
  try {
    const loggedInUser = req.user;
    const hidden = await blockedIdsFor(loggedInUser);
    const connectionRequests = await connectionRequest
      .find({
        toUserId: loggedInUser._id,
        status: "interested",
      })
      .populate("fromUserId", USER_SAFE_DATA);

    // Added: hide requests from deleted or blocked users
    const data = connectionRequests.filter(
      (r) => r.fromUserId && !hidden.has(String(r.fromUserId._id))
    );
    res.json({ data });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// Get all accepted connections for the user
userRouter.get("/user/connections", userAuth, async (req, res) => {
  try {
    const loggedInUser = req.user;
    const hidden = await blockedIdsFor(loggedInUser);
    const connectionRequests = await connectionRequest
      .find({
        $or: [
          { toUserId: loggedInUser._id, status: "accepted" },
          { fromUserId: loggedInUser._id, status: "accepted" },
        ],
      })
      .populate("fromUserId", USER_SAFE_DATA)
      .populate("toUserId", USER_SAFE_DATA); // ✅ Fix: Populate both user fields

    // Fixed: skip rows whose other user was deleted (populate returns null) or is blocked
    const data = connectionRequests
      .filter((row) => row.fromUserId && row.toUserId)
      .map((row) =>
        row.fromUserId._id.equals(loggedInUser._id) ? row.toUserId : row.fromUserId
      )
      .filter((user) => !hidden.has(String(user._id)));

    res.json({ data });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// FEED API
// Added: optional ?skills=react,node filter (case-insensitive exact skill match)
userRouter.get("/feed", userAuth, async (req, res) => {
  try {
    const loggedInUser = req.user;
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    let limit = parseInt(req.query.limit) || 10;
    limit = limit > 50 ? 50 : limit;

    const skip = (page - 1) * limit;

    const connectionRequests = await connectionRequest
      .find({
        $or: [{ fromUserId: loggedInUser._id }, { toUserId: loggedInUser._id }],
      })
      .select("fromUserId toUserId");

    const hideUserFromFeed = await blockedIdsFor(loggedInUser);
    connectionRequests.forEach((req) => {
      hideUserFromFeed.add(req.fromUserId.toString());
      hideUserFromFeed.add(req.toUserId.toString());
    });

    // Changed: ObjectIds, because the query below is an aggregation (no auto-casting)
    const toObjectIds = (ids) => ids.filter(isId).map((id) => new mongoose.Types.ObjectId(id));
    const filter = {
      $and: [
        { _id: { $nin: toObjectIds(Array.from(hideUserFromFeed)) } },
        { _id: { $ne: loggedInUser._id } },
      ],
    };
    const skills = String(req.query.skills || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 5);
    if (skills.length) filter.$and.push({ skills: { $in: skills } });

    // Changed: Premium members' profiles are shown first (the Premium visibility
    // benefit); everyone else keeps the previous order
    const projection = Object.fromEntries(USER_SAFE_DATA.split(" ").map((f) => [f, 1]));
    const users = await User.aggregate([
      { $match: filter },
      { $addFields: { _boost: { $cond: [{ $gt: ["$premiumExpiresAt", new Date()] }, 1, 0] } } },
      { $sort: { _boost: -1, _id: 1 } },
      { $skip: skip },
      { $limit: limit },
      { $project: projection },
    ]).collation({ locale: "en", strength: 2 }); // case-insensitive skill match

    res.json({ data: users });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// Added: block a user. They disappear from your feed, requests, connections and
// chat, and you from theirs. Pending requests between you are withdrawn.
userRouter.post("/user/block/:userId", userAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    if (!isId(userId) || req.user._id.equals(userId)) {
      return res.status(400).json({ message: "Invalid user" });
    }
    if (!(await User.exists({ _id: userId }))) {
      return res.status(404).json({ message: "User not found" });
    }
    await User.updateOne({ _id: req.user._id }, { $addToSet: { blockedUsers: userId } });
    await connectionRequest.updateMany(
      {
        status: "interested",
        $or: [
          { fromUserId: req.user._id, toUserId: userId },
          { fromUserId: userId, toUserId: req.user._id },
        ],
      },
      { $set: { status: "ignored" } }
    );
    res.json({ message: "User blocked" });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

userRouter.delete("/user/block/:userId", userAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    if (!isId(userId)) return res.status(400).json({ message: "Invalid user" });
    await User.updateOne({ _id: req.user._id }, { $pull: { blockedUsers: userId } });
    res.json({ message: "User unblocked" });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

userRouter.get("/user/blocked", userAuth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).populate(
      "blockedUsers",
      "firstName lastName photoURL"
    );
    res.json({ data: (user.blockedUsers || []).filter(Boolean) });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// Added: report a user (optionally blocking them too). The admin gets an email
// when REPORTS_EMAIL is set.
userRouter.post("/user/report/:userId", userAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    const { reason, details = "", block = false } = req.body;
    if (!isId(userId) || req.user._id.equals(userId)) {
      return res.status(400).json({ message: "Invalid user" });
    }
    const reported = await User.findById(userId).select("firstName lastName");
    if (!reported) return res.status(404).json({ message: "User not found" });
    if (!REPORT_REASONS.includes(reason)) {
      return res.status(400).json({ message: "Please choose a reason for the report." });
    }

    try {
      await Report.create({
        reporterId: req.user._id,
        reportedUserId: userId,
        reason,
        details: String(details).slice(0, 1000),
      });
    } catch (err) {
      if (err.code === 11000) {
        return res.status(409).json({ message: "You have already reported this user." });
      }
      throw err;
    }

    if (block) {
      await User.updateOne({ _id: req.user._id }, { $addToSet: { blockedUsers: userId } });
    }

    if (process.env.REPORTS_EMAIL) {
      sendEmail.sendUserReportedEmail(process.env.REPORTS_EMAIL, {
        reporter: req.user,
        reported,
        reason,
        details,
      });
    }

    res.status(201).json({ message: "Thanks, we've received your report." });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

module.exports = userRouter;
module.exports.USER_SAFE_DATA = USER_SAFE_DATA;
