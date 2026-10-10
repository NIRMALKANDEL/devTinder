// Added: shared checks for blocks and connections (used by feed, requests, chat)
const { User } = require("../models/user");
const { connectionRequest } = require("../models/connectionRequest");

// Ids hidden from this user: people they blocked + people who blocked them
const blockedIdsFor = async (user) => {
  const blockedMe = await User.find({ blockedUsers: user._id }).select("_id").lean();
  return new Set([
    ...(user.blockedUsers || []).map(String),
    ...blockedMe.map((u) => String(u._id)),
  ]);
};

// True if either user has blocked the other
const isBlockedBetween = async (userId, otherId) =>
  Boolean(
    await User.exists({
      $or: [
        { _id: userId, blockedUsers: otherId },
        { _id: otherId, blockedUsers: userId },
      ],
    })
  );

// True if the two users have an accepted connection (in either direction)
const areConnected = async (userId, otherId) =>
  Boolean(
    await connectionRequest.exists({
      status: "accepted",
      $or: [
        { fromUserId: userId, toUserId: otherId },
        { fromUserId: otherId, toUserId: userId },
      ],
    })
  );

// Chat is allowed only between connected users where nobody blocked anybody
const canChat = async (userId, otherId) =>
  String(userId) !== String(otherId) &&
  (await areConnected(userId, otherId)) &&
  !(await isBlockedBetween(userId, otherId));

module.exports = { blockedIdsFor, isBlockedBetween, areConnected, canChat };
