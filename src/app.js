require("dotenv").config({ quiet: true });
const http = require("http");
const express = require("express");
const mongoose = require("mongoose");
const helmet = require("helmet");
const { connectDB } = require("./config/Database");
const app = express();
const cookieParser = require("cookie-parser");
const cors = require("cors");
const { emailQueue } = require("./utils/sendEmail");
const { apiLimiter } = require("./middlewares/rateLimit");

// Added: production runs behind nginx (and Cloudflare in front of it). This tells
// Express how many proxies to trust, so req.ip is the visitor's IP (rate limits)
// and req.secure follows X-Forwarded-Proto (secure cookie). Must match the real chain.
const trustProxy = process.env.TRUST_PROXY ?? "1";
app.set("trust proxy", /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy);

app.use(helmet()); // Added: standard security headers
app.use(express.json({ limit: "1mb" })); // Changed: room for an uploaded profile photo
app.use(cookieParser());
app.use(
  cors({
    // Changed: comma-separated list from env (production is same-origin via nginx)
    origin: (process.env.CORS_ORIGINS || "http://localhost:5173").split(","),
    credentials: true, // Enable credentials (cookies, authorization headers, etc.)
  })
);

// Added: health check for uptime monitors (no rate limit, no auth)
app.get("/health", (req, res) => {
  const dbUp = mongoose.connection.readyState === 1;
  res.status(dbUp ? 200 : 503).json({ status: dbUp ? "ok" : "db_down", uptime: Math.round(process.uptime()) });
});

app.use(apiLimiter);

const authRouter = require("./routes/auth");
const profileRouter = require("./routes/profile");
const requestRouter = require("./routes/request");
const userRouter = require("./routes/user");
const chatRouter = require("./routes/chat");

app.use("/", authRouter);
app.use("/", profileRouter);
app.use("/", requestRouter);
app.use("/", userRouter);
app.use("/", chatRouter);

app.use((req, res) => res.status(404).json({ message: "Not found" }));

// Added: every error becomes JSON { message }; internals are logged, not sent
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.type === "entity.too.large") {
    return res.status(413).json({ message: "That upload is too large. Please use a smaller photo." });
  }
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({ message: "Invalid JSON in request body." });
  }
  console.error("Unhandled error:", err);
  res.status(500).json({ message: "Something went wrong. Please try again." });
});

const start = async () => {
  await connectDB();
  console.log("Database connection established");

  // Daily pending-request emails. Set ENABLE_CRON=false on local/dev machines that
  // share the production database, or users get the digest more than once.
  if (process.env.ENABLE_CRON !== "false") {
    require("./utils/cronjob");
  }

  const server = http.createServer(app);
  require("./socket").initSocket(server); // Added: real-time chat
  const PORT = process.env.PORT || 7777;
  server.listen(PORT, () => {
    console.log(`Server is successfully listening on port ${PORT}...`);
  });

  // On shutdown (deploys, restarts) send any queued emails before exiting
  const shutdown = async (signal) => {
    console.log(`${signal} received, finishing requests and queued emails...`);
    // Let in-flight requests finish (they may still queue emails), max 10s
    await new Promise((resolve) => {
      server.close(resolve);
      server.closeIdleConnections();
      setTimeout(resolve, 10000).unref();
    });
    const drained = await emailQueue.drain();
    if (!drained) {
      console.error("[email] shutdown timeout, unsent:", emailQueue.getStats());
    }
    process.exit(0);
  };
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));
};

// Started directly (npm start / pm2): connect and listen. Required by tests: just export.
if (require.main === module) {
  start().catch((err) => {
    console.error("Database connection failed: ", err.message);
  });
}

module.exports = { app, start };
