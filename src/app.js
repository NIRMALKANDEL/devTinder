require("dotenv").config();
const express = require("express");
const { connectDB } = require("./config/Database");
const app = express();
const cookieParser = require("cookie-parser");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const { emailQueue } = require("./utils/sendEmail");
// Daily pending-request emails. Set ENABLE_CRON=false on local/dev machines that
// share the production database, or users get the digest more than once.
if (process.env.ENABLE_CRON !== "false") {
  require("./utils/cronjob");
}
app.use(express.json());
app.use(cookieParser());
app.use(
  cors({
    origin: "http://localhost:5173", // Allow requests from this origin
    credentials: true, // Enable credentials (cookies, authorization headers, etc.)
  })
);

const authRouter = require("./routes/auth");
const profileRouter = require("./routes/profile");
const requestRouter = require("./routes/request");
const userRouter = require("./routes/user");

app.use("/", authRouter);
app.use("/", profileRouter);
app.use("/", requestRouter);
app.use("/", userRouter);

// Start server after database connection
connectDB()
  .then(() => {
    console.log("Database connection established");
    const PORT = process.env.PORT || 7777;
    const server = app.listen(PORT, () => {
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
  })
  .catch((err) => {
    console.error("Database connection failed: ", err.message);
  });
