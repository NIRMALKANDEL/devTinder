// Added: chat between connected users. Messages are sent over Socket.IO
// (src/socket.js); these routes load the conversation list and history.
const express = require("express");
const mongoose = require("mongoose");
const { userAuth } = require("../middlewares/auth");
const { Chat, Message } = require("../models/chat");
const { pairKeyFor } = require("../models/connectionRequest");
const { canChat, blockedIdsFor } = require("../utils/relations");

const chatRouter = express.Router();
const CHAT_USER_DATA = "firstName lastName photoURL";
const PAGE_SIZE = 30;

// Finds the chat for two users, creating it on first use
const getOrCreateChat = (userId, otherId) =>
  Chat.findOneAndUpdate(
    { pairKey: pairKeyFor(userId, otherId) },
    { $setOnInsert: { participants: [userId, otherId], pairKey: pairKeyFor(userId, otherId) } },
    { upsert: true, new: true }
  );

// Conversation list, most recent first
chatRouter.get("/chats", userAuth, async (req, res) => {
  try {
    const hidden = await blockedIdsFor(req.user);
    const chats = await Chat.find({ participants: req.user._id, "lastMessage.text": { $exists: true } })
      .sort({ updatedAt: -1 })
      .limit(50)
      .populate("participants", CHAT_USER_DATA);

    const data = chats
      .map((chat) => ({
        _id: chat._id,
        user: chat.participants.find((p) => p && !p._id.equals(req.user._id)),
        lastMessage: chat.lastMessage,
        updatedAt: chat.updatedAt,
      }))
      .filter((c) => c.user && !hidden.has(String(c.user._id)));
    res.json({ data });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// Messages with one user, newest page first. ?before=<messageId> loads older ones.
chatRouter.get("/chat/:userId", userAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    if (!mongoose.isValidObjectId(userId)) {
      return res.status(400).json({ message: "Invalid user" });
    }
    if (!(await canChat(req.user._id, userId))) {
      return res.status(403).json({ message: "You can only chat with your connections." });
    }

    const chat = await getOrCreateChat(req.user._id, userId);
    const query = { chatId: chat._id };
    if (mongoose.isValidObjectId(req.query.before)) {
      query._id = { $lt: req.query.before };
    }
    const messages = await Message.find(query).sort({ _id: -1 }).limit(PAGE_SIZE);

    res.json({
      data: {
        chatId: chat._id,
        messages: messages.reverse(),
        hasMore: messages.length === PAGE_SIZE,
      },
    });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

module.exports = chatRouter;
module.exports.getOrCreateChat = getOrCreateChat;
