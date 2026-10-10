// Added: real-time chat over Socket.IO.
// The browser connects through the same /api proxy as the REST calls
// (path /api/socket.io in the browser, /socket.io here after nginx/Vite strip /api),
// so the login cookie comes along and is checked just like userAuth does.
const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { User } = require("./models/user");
const { Message } = require("./models/chat");
const { canChat } = require("./utils/relations");
const { getOrCreateChat } = require("./routes/chat");

const parseCookies = (header = "") =>
  Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim().split("="))
      .filter(([key]) => key)
      .map(([key, ...rest]) => [key, decodeURIComponent(rest.join("="))])
  );

// Same rules as middlewares/auth.js
const authenticate = async (socket, next) => {
  try {
    const { token } = parseCookies(socket.handshake.headers.cookie);
    if (!token) return next(new Error("unauthorized"));
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded._id).select("+passwordChangedAt firstName");
    if (
      !user ||
      (user.passwordChangedAt &&
        decoded.iat < Math.floor(user.passwordChangedAt.getTime() / 1000))
    ) {
      return next(new Error("unauthorized"));
    }
    socket.data.userId = String(user._id);
    next();
  } catch {
    next(new Error("unauthorized"));
  }
};

// Max 10 messages per 10 seconds per connection
const allowMessage = (socket) => {
  const now = Date.now();
  socket.data.sent = (socket.data.sent || []).filter((t) => now - t < 10000);
  if (socket.data.sent.length >= 10) return false;
  socket.data.sent.push(now);
  return true;
};

const initSocket = (server) => {
  const io = new Server(server, {
    cors: {
      origin: (process.env.CORS_ORIGINS || "http://localhost:5173").split(","),
      credentials: true,
    },
    maxHttpBufferSize: 16 * 1024, // messages are small text
  });

  io.use(authenticate);

  io.on("connection", (socket) => {
    const userId = socket.data.userId;
    // Each user listens on a personal room, so every open tab gets new messages
    socket.join(`user:${userId}`);

    socket.on("sendMessage", async ({ toUserId, text } = {}, ack = () => {}) => {
      try {
        const body = String(text || "").trim();
        if (!mongoose.isValidObjectId(toUserId) || !body) {
          return ack({ ok: false, message: "Message can't be empty." });
        }
        if (body.length > 2000) {
          return ack({ ok: false, message: "Messages can be at most 2000 characters." });
        }
        if (!allowMessage(socket)) {
          return ack({ ok: false, message: "You're sending messages too fast." });
        }
        if (!(await canChat(userId, toUserId))) {
          return ack({ ok: false, message: "You can only chat with your connections." });
        }

        const chat = await getOrCreateChat(userId, toUserId);
        const message = await Message.create({ chatId: chat._id, senderId: userId, text: body });
        chat.lastMessage = { text: body, senderId: userId, createdAt: message.createdAt };
        await chat.save();

        const payload = {
          _id: message._id,
          chatId: chat._id,
          senderId: userId,
          text: message.text,
          createdAt: message.createdAt,
        };
        io.to(`user:${userId}`).to(`user:${toUserId}`).emit("messageReceived", payload);
        ack({ ok: true, message: payload });
      } catch (err) {
        console.error("[chat] sendMessage failed:", err.message);
        ack({ ok: false, message: "Message could not be sent. Please try again." });
      }
    });

    // Typing indicator, only forwarded between people who can chat
    socket.on("typing", async ({ toUserId } = {}) => {
      if (mongoose.isValidObjectId(toUserId) && (await canChat(userId, toUserId))) {
        socket.to(`user:${toUserId}`).emit("typing", { fromUserId: userId });
      }
    });
  });

  return io;
};

module.exports = { initSocket };
