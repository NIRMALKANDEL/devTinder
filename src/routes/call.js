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
  // Fixed: accept "host:port" too; browsers reject TURN URLs without the turn:/turns: scheme,
  // which broke every call ("Couldn't start your camera") instead of just skipping TURN
  const turnUrls = list(process.env.TURN_URLS).map((u) => (/^turns?:/i.test(u) ? u : `turn:${u}`));
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

// Added: Cloudflare Realtime TURN (free tier: 1,000 GB a month).
// CF_TURN_KEY_ID + CF_TURN_API_TOKEN come from Cloudflare dashboard > Realtime > TURN Server.
// Cloudflare hands out short-lived TURN credentials; the API token never leaves the server.
const cloudflareTurn = async (ttl) => {
  const keyId = process.env.CF_TURN_KEY_ID;
  const token = process.env.CF_TURN_API_TOKEN;
  if (!keyId || !token) return null;
  try {
    const res = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ttl }),
        signal: AbortSignal.timeout(5000),
      }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    const servers = Array.isArray(body.iceServers) ? body.iceServers : [body.iceServers];
    // Port 53 is blocked by most browsers; drop those URLs
    return servers
      .filter(Boolean)
      .map((s) => ({ ...s, urls: [].concat(s.urls).filter((u) => !/:53(\?|$)/.test(u)) }))
      .filter((s) => s.urls.length);
  } catch (err) {
    console.error("[call] Cloudflare TURN credentials failed:", err.message);
    return null;
  }
};

callRouter.get("/call/ice-servers", userAuth, async (req, res) => {
  res.set("Cache-Control", "no-store");
  const config = iceConfigFor(String(req.user._id));
  if (!config.turnConfigured) {
    const cf = await cloudflareTurn(config.ttl);
    if (cf?.length) {
      config.iceServers = [...config.iceServers, ...cf];
      config.turnConfigured = true;
      if (process.env.CALL_FORCE_RELAY === "true") config.iceTransportPolicy = "relay";
    }
  }
  res.json({ data: config });
});

module.exports = callRouter;
module.exports.iceConfigFor = iceConfigFor;
