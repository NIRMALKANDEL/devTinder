// Added: one-to-one call signaling over the existing Socket.IO connection.
// Socket.IO only carries the call setup (ringing, accept/reject, WebRTC offer/answer
// and ICE candidates). The audio/video itself goes peer to peer over WebRTC, or
// through the TURN relay (see routes/call.js).
//
// Rules:
//  - only accepted connections who haven't blocked each other can call (same as chat)
//  - audio: every logged-in user; video: the caller needs active Premium
//  - one call per user at a time (busy otherwise); 30 s ringing timeout
//  - each call has a random id and is bound to the two users and, once answered, to
//    the one browser tab on each side, so nobody else can inject or end it
// State lives in memory. That is fine for the single pm2 instance this app runs as;
// running several instances would need a shared store (e.g. the Socket.IO Redis adapter).
const crypto = require("crypto");
const mongoose = require("mongoose");
const { User } = require("./models/user");
const { canChat } = require("./utils/relations");
const { isPremiumActive } = require("./utils/premium");

const RING_MS = Number(process.env.CALL_RING_TIMEOUT_MS) || 30000;
const RECONNECT_GRACE_MS = Number(process.env.CALL_RECONNECT_GRACE_MS) || 15000;
const KINDS = ["audio", "video"];
const REJECT_REASONS = ["rejected", "busy", "unavailable"];
const MAX_SDP = 20000;
const MAX_CANDIDATE = 2000;

// Sliding-window limit stored on the socket
const allow = (socket, key, max, windowMs) => {
  const now = Date.now();
  const list = (socket.data[key] || []).filter((t) => now - t < windowMs);
  if (list.length >= max) {
    socket.data[key] = list;
    return false;
  }
  list.push(now);
  socket.data[key] = list;
  return true;
};

// Only pass on the fields WebRTC needs, with size limits
const cleanSignal = (data) => {
  if (!data || typeof data !== "object") return null;
  if (data.type === "offer" || data.type === "answer") {
    if (typeof data.sdp !== "string" || !data.sdp || data.sdp.length > MAX_SDP) return null;
    return { type: data.type, sdp: data.sdp, iceRestart: Boolean(data.iceRestart) };
  }
  if (data.type === "candidate") {
    const c = data.candidate;
    if (c === null) return { type: "candidate", candidate: null }; // end of candidates
    if (!c || typeof c.candidate !== "string" || c.candidate.length > MAX_CANDIDATE) return null;
    return {
      type: "candidate",
      candidate: {
        candidate: c.candidate,
        sdpMid: typeof c.sdpMid === "string" ? c.sdpMid.slice(0, 64) : null,
        sdpMLineIndex: Number.isInteger(c.sdpMLineIndex) ? c.sdpMLineIndex : null,
      },
    };
  }
  return null;
};

const createCallService = (io) => {
  const calls = new Map(); // callId -> call
  const callOfUser = new Map(); // userId -> callId

  const room = (userId) => `user:${userId}`;
  const isOnline = (userId) => (io.sockets.adapter.rooms.get(room(userId))?.size || 0) > 0;

  const endCall = (call, reason) => {
    if (!calls.has(call.id)) return;
    clearTimeout(call.ringTimer);
    Object.values(call.graceTimers).forEach(clearTimeout);
    calls.delete(call.id);
    if (callOfUser.get(call.callerId) === call.id) callOfUser.delete(call.callerId);
    if (callOfUser.get(call.calleeId) === call.id) callOfUser.delete(call.calleeId);
    io.to(room(call.callerId)).to(room(call.calleeId)).emit("call:ended", { callId: call.id, reason });
  };

  // The socket currently bound to this user in the call (null while ringing for the callee)
  const socketOf = (call, userId) =>
    userId === call.callerId ? call.callerSocket : userId === call.calleeId ? call.calleeSocket : null;

  const attach = (socket) => {
    const userId = socket.data.userId;
    const getCall = (callId) => (typeof callId === "string" ? calls.get(callId) : undefined);

    socket.on("call:start", async ({ toUserId, kind } = {}, ack = () => {}) => {
      if (typeof ack !== "function") return;
      try {
        if (!KINDS.includes(kind) || !mongoose.isValidObjectId(toUserId) || String(toUserId) === userId) {
          return ack({ ok: false, reason: "invalid", message: "Invalid call." });
        }
        const calleeId = String(toUserId);
        if (!allow(socket, "callStarts", 5, 60000)) {
          return ack({ ok: false, reason: "rate_limited", message: "Too many calls. Please wait a minute." });
        }
        if (callOfUser.has(userId)) {
          return ack({ ok: false, reason: "already_in_call", message: "You're already in a call." });
        }
        if (!(await canChat(userId, calleeId))) {
          return ack({ ok: false, reason: "not_allowed", message: "You can only call your connections." });
        }
        const caller = await User.findById(userId).select("firstName lastName photoURL premiumExpiresAt");
        if (!caller) return ack({ ok: false, reason: "invalid", message: "Invalid call." });
        if (kind === "video" && !isPremiumActive(caller)) {
          return ack({
            ok: false,
            reason: "premium_required",
            message: "Video calling is a Premium feature. Audio calls are free.",
          });
        }
        if (!isOnline(calleeId)) {
          return ack({ ok: false, reason: "offline", message: "They're offline right now. Try again later." });
        }
        // Checked again after the awaits above (two quick clicks, or both calling at once)
        if (callOfUser.has(userId)) {
          return ack({ ok: false, reason: "already_in_call", message: "You're already in a call." });
        }
        if (callOfUser.has(calleeId)) {
          return ack({ ok: false, reason: "busy", message: "They're on another call." });
        }

        const call = {
          id: crypto.randomUUID(),
          kind,
          callerId: userId,
          calleeId,
          callerSocket: socket.id,
          calleeSocket: null,
          state: "ringing",
          graceTimers: {},
          createdAt: Date.now(),
        };
        call.ringTimer = setTimeout(() => endCall(call, "timeout"), RING_MS);
        calls.set(call.id, call);
        callOfUser.set(userId, call.id);
        callOfUser.set(calleeId, call.id);

        io.to(room(calleeId)).emit("call:incoming", {
          callId: call.id,
          kind,
          from: {
            _id: userId,
            firstName: caller.firstName,
            lastName: caller.lastName,
            photoURL: caller.photoURL,
          },
          ringMs: RING_MS,
        });
        ack({ ok: true, callId: call.id, ringMs: RING_MS });
      } catch (err) {
        console.error("[call] start failed:", err.message);
        ack({ ok: false, reason: "error", message: "The call couldn't be started. Please try again." });
      }
    });

    socket.on("call:accept", ({ callId } = {}, ack = () => {}) => {
      if (typeof ack !== "function") return;
      const call = getCall(callId);
      if (!call || call.calleeId !== userId) return ack({ ok: false, message: "This call has ended." });
      if (call.state !== "ringing") return ack({ ok: false, message: "This call was answered elsewhere." });
      call.state = "active";
      call.calleeSocket = socket.id;
      call.acceptedAt = Date.now();
      clearTimeout(call.ringTimer);
      io.to(call.callerSocket).emit("call:accepted", { callId: call.id });
      // Other tabs of the callee stop ringing
      socket.to(room(userId)).emit("call:handled-elsewhere", { callId: call.id });
      ack({ ok: true, kind: call.kind });
    });

    socket.on("call:reject", ({ callId, reason } = {}) => {
      const call = getCall(callId);
      if (!call || call.calleeId !== userId || call.state !== "ringing") return;
      endCall(call, REJECT_REASONS.includes(reason) ? reason : "rejected");
    });

    // Caller cancelling while it rings, or either side hanging up.
    // reason "failed": the browser gave up because audio/video couldn't connect
    // (network), so both people see that instead of "… ended the call".
    socket.on("call:end", ({ callId, reason } = {}) => {
      const call = getCall(callId);
      if (!call || socketOf(call, userId) !== socket.id) return;
      if (call.state === "ringing") return endCall(call, "cancelled");
      endCall(call, reason === "failed" ? "failed" : "ended");
    });

    socket.on("call:signal", ({ callId, data } = {}) => {
      const call = getCall(callId);
      if (!call || call.state !== "active" || socketOf(call, userId) !== socket.id) return;
      if (!allow(socket, "signals", 300, 10000)) return;
      const clean = cleanSignal(data);
      if (!clean) return;
      const target = userId === call.callerId ? call.calleeSocket : call.callerSocket;
      if (target) io.to(target).emit("call:signal", { callId: call.id, data: clean });
    });

    // After a dropped connection, Socket.IO reconnects with a new socket id;
    // the browser calls this to take its place in the call again
    socket.on("call:resume", ({ callId } = {}, ack = () => {}) => {
      if (typeof ack !== "function") return;
      const call = getCall(callId);
      if (!call || (userId !== call.callerId && userId !== call.calleeId)) return ack({ ok: false });
      // While ringing only the caller is bound; an accepted call needs the same user
      if (call.state === "ringing" && userId !== call.callerId) return ack({ ok: false });
      if (userId === call.callerId) call.callerSocket = socket.id;
      else call.calleeSocket = socket.id;
      clearTimeout(call.graceTimers[userId]);
      delete call.graceTimers[userId];
      const peerSocket = userId === call.callerId ? call.calleeSocket : call.callerSocket;
      if (peerSocket) io.to(peerSocket).emit("call:peer-reconnected", { callId: call.id });
      ack({ ok: true, state: call.state });
    });

    socket.on("disconnect", () => {
      const call = getCall(callOfUser.get(userId));
      if (!call || socketOf(call, userId) !== socket.id) return;
      const peerSocket = userId === call.callerId ? call.calleeSocket : call.callerSocket;
      if (peerSocket) io.to(peerSocket).emit("call:peer-reconnecting", { callId: call.id });
      // Give the browser a moment to reconnect before ending the call
      call.graceTimers[userId] = setTimeout(() => endCall(call, "disconnected"), RECONNECT_GRACE_MS);
    });
  };

  return { attach, _state: { calls, callOfUser } };
};

module.exports = { createCallService, cleanSignal };
