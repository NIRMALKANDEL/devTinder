// Added: ICE servers (STUN/TURN) for in-app calls. Call signaling itself runs over
// Socket.IO (src/calls.js); audio/video go peer to peer over WebRTC, or through the
// TURN relay on networks that block direct connections.
const crypto = require("crypto");
const express = require("express");
const { userAuth } = require("../middlewares/auth");

const callRouter = express.Router();

const list = (value) =>
  String(value || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

// Builds the iceServers list for one user.
// TURN options (pick one):
//  - TURN_SECRET: coturn "use-auth-secret" (TURN REST API). Credentials are made per
//    user and expire after TURN_TTL_SECONDS, so the shared secret never leaves the server.
//  - TURN_USERNAME + TURN_CREDENTIAL: fixed credentials from a hosted TURN provider.
const iceConfigFor = (userId) => {
  const stunUrls = list(process.env.STUN_URLS || "stun:stun.l.google.com:19302");
  const turnUrls = list(process.env.TURN_URLS);
  const ttl = Math.max(Number(process.env.TURN_TTL_SECONDS) || 3600, 300);
  const iceServers = stunUrls.length ? [{ urls: stunUrls }] : [];
  let turnConfigured = false;

  if (turnUrls.length && process.env.TURN_SECRET) {
    const username = `${Math.floor(Date.now() / 1000) + ttl}:${userId}`;
    const credential = crypto.createHmac("sha1", process.env.TURN_SECRET).update(username).digest("base64");
    iceServers.push({ urls: turnUrls, username, credential });
    turnConfigured = true;
  } else if (turnUrls.length && process.env.TURN_USERNAME && process.env.TURN_CREDENTIAL) {
    iceServers.push({
      urls: turnUrls,
      username: process.env.TURN_USERNAME,
      credential: process.env.TURN_CREDENTIAL,
    });
    turnConfigured = true;
  }

  return {
    iceServers,
    turnConfigured,
    // CALL_FORCE_RELAY=true sends all media through TURN, which hides each
    // person's IP address from the other (needs TURN)
    iceTransportPolicy: turnConfigured && process.env.CALL_FORCE_RELAY === "true" ? "relay" : "all",
    ttl,
  };
};

callRouter.get("/call/ice-servers", userAuth, (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({ data: iceConfigFor(String(req.user._id)) });
});

module.exports = callRouter;
module.exports.iceConfigFor = iceConfigFor;
