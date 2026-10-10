const mongoose = require("mongoose");

// Added: one conversation between two connected users
const chatSchema = new mongoose.Schema(
  {
    participants: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
      validate: { validator: (v) => v.length === 2, message: "A chat has exactly two people." },
    },
    // Sorted participant ids ("a:b"), so each pair has exactly one chat
    pairKey: { type: String, required: true, unique: true },
    lastMessage: {
      text: String,
      senderId: mongoose.Schema.Types.ObjectId,
      createdAt: Date,
    },
  },
  { timestamps: true }
);
chatSchema.index({ participants: 1, updatedAt: -1 });

const messageSchema = new mongoose.Schema(
  {
    chatId: { type: mongoose.Schema.Types.ObjectId, ref: "Chat", required: true },
    senderId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    text: {
      type: String,
      required: true,
      trim: true,
      maxlength: [2000, "Messages can be at most 2000 characters."],
    },
  },
  { timestamps: true }
);
messageSchema.index({ chatId: 1, createdAt: -1 });

const Chat = mongoose.model("Chat", chatSchema);
const Message = mongoose.model("Message", messageSchema);
module.exports = { Chat, Message };
