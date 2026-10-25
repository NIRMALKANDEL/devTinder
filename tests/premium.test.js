// Added: Premium, Razorpay payments, webhooks and call signaling. Runs against a
// throwaway in-memory MongoDB; Razorpay's API is mocked, so no network is used.
const http = require("http");
const crypto = require("crypto");
const { MongoMemoryServer } = require("mongodb-memory-server");
const mongoose = require("mongoose");
const request = require("supertest");
const { io: ioClient } = require("socket.io-client");

let mongo, app, server, baseUrl, User, connectionRequest, Payment, WebhookEvent, razorpay;
let ipCounter = 0;
const nextIp = () => `10.1.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`;
const PASSWORD = "Dev@12345";
const KEY_SECRET = "test_key_secret";
const WEBHOOK_SECRET = "test_webhook_secret";
const DAY = 24 * 60 * 60 * 1000;

const createUser = async (firstName, extra = {}) => {
  const bcrypt = require("bcryptjs");
  return User.create({
    firstName,
    lastName: "Test",
    emailId: `${firstName.toLowerCase()}@example.com`,
    password: await bcrypt.hash(PASSWORD, 4),
    isEmailVerified: true,
    ...extra,
  });
};

const login = async (user) => {
  const res = await request(app)
    .post("/login")
    .set("X-Forwarded-For", nextIp())
    .send({ emailId: user.emailId, password: PASSWORD });
  expect(res.status).toBe(200);
  return res.headers["set-cookie"].find((c) => c.startsWith("token=")).split(";")[0];
};

const connect = (a, b) =>
  connectionRequest.create({ fromUserId: a._id, toUserId: b._id, status: "accepted" });

const sign = (data, secret) => crypto.createHmac("sha256", secret).update(data).digest("hex");

let orderSeq = 0;
const mockCreateOrder = () =>
  jest.spyOn(razorpay, "createOrder").mockImplementation(async ({ amount, currency }) => ({
    id: `order_Test${++orderSeq}abcdef`,
    amount,
    currency,
    status: "created",
  }));

const rpPayment = (orderId, extra = {}) => ({
  id: `pay_${orderId.slice(6)}`,
  order_id: orderId,
  amount: 10000,
  currency: "INR",
  status: "captured",
  ...extra,
});

const checkoutResult = (orderId, paymentId = `pay_${orderId.slice(6)}`) => ({
  razorpay_order_id: orderId,
  razorpay_payment_id: paymentId,
  razorpay_signature: sign(`${orderId}|${paymentId}`, KEY_SECRET),
});

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongo.getUri("test");
  process.env.JWT_SECRET = "test-secret";
  process.env.EMAIL_DRY_RUN = "true";
  process.env.ENABLE_CRON = "false";
  process.env.RAZORPAY_KEY_ID = "rzp_test_abc123";
  process.env.RAZORPAY_KEY_SECRET = KEY_SECRET;
  process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;
  process.env.PREMIUM_PRICE_PAISE = "10000";
  process.env.PREMIUM_DURATION_DAYS = "30";
  process.env.CALL_RING_TIMEOUT_MS = "800";
  process.env.CALL_RECONNECT_GRACE_MS = "1500";
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});

  ({ app } = require("../src/app"));
  ({ User } = require("../src/models/user"));
  ({ connectionRequest } = require("../src/models/connectionRequest"));
  ({ Payment, WebhookEvent } = require("../src/models/payment"));
  razorpay = require("../src/utils/razorpay");
  await mongoose.connect(process.env.MONGODB_URI);
  await mongoose.connection.syncIndexes();

  server = http.createServer(app);
  require("../src/socket").initSocket(server);
  await new Promise((r) => server.listen(0, r));
  baseUrl = `http://localhost:${server.address().port}`;
});

afterAll(async () => {
  await new Promise((r) => server.close(r));
  await mongoose.disconnect();
  await mongo.stop();
  await require("../src/utils/sendEmail").emailQueue.drain(1000);
});

beforeEach(async () => {
  jest.restoreAllMocks();
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
  await Promise.all([User, connectionRequest, Payment, WebhookEvent].map((m) => m.deleteMany({})));
});

describe("premium plan and entitlement", () => {
  test("plan comes from the server config; price unset disables checkout", async () => {
    let res = await request(app).get("/premium/plan");
    expect(res.body.data).toMatchObject({ amount: 10000, durationDays: 30, checkoutEnabled: true, mode: "test" });

    process.env.PREMIUM_PRICE_PAISE = "";
    res = await request(app).get("/premium/plan");
    expect(res.body.data.checkoutEnabled).toBe(false);
    expect(res.body.data.priceConfirmed).toBe(false);
    const a = await createUser("Alpha");
    const order = await request(app).post("/payment/create-order").set("Cookie", await login(a));
    expect(order.status).toBe(503);
    process.env.PREMIUM_PRICE_PAISE = "10000";
  });

  test("Premium can't be set through profile edit", async () => {
    const a = await createUser("Alpha");
    const cookie = await login(a);
    await request(app)
      .patch("/profile/edit")
      .set("Cookie", cookie)
      .send({ about: "hi", premiumExpiresAt: new Date(Date.now() + 99 * DAY) });
    const me = await request(app).get("/profile/view").set("Cookie", cookie);
    expect(me.body.payload.isPremium).toBe(false);
    expect(me.body.payload.premiumExpiresAt).toBeNull();
  });

  test("recommendations are Premium-only, max 5, ranked by shared skills, excluding contacts", async () => {
    const a = await createUser("Alpha", { skills: ["React", "Node.js"] });
    const cookie = await login(a);
    expect((await request(app).get("/premium/recommendations").set("Cookie", cookie)).status).toBe(403);

    await User.updateOne({ _id: a._id }, { premiumExpiresAt: new Date(Date.now() + DAY) });
    const both = await createUser("Bothskills", { skills: ["react", "node.js"] });
    const one = await createUser("Oneskill", { skills: ["React"] });
    const friend = await createUser("Friend", { skills: ["React", "Node.js"] });
    await connect(a, friend);
    for (const n of ["Other1", "Other2", "Other3", "Other4"]) await createUser(n, { skills: ["Go"] });

    const res = await request(app).get("/premium/recommendations").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(5);
    expect(res.body.data[0]._id).toBe(String(both._id));
    expect(res.body.data[1]._id).toBe(String(one._id));
    expect(res.body.data.map((u) => u._id)).not.toContain(String(friend._id));
    expect(res.body.data[0].emailId).toBeUndefined();
  });

  test("feed shows Premium members first", async () => {
    const a = await createUser("Alpha");
    await createUser("Freeuser");
    const p = await createUser("Premiumuser", { premiumExpiresAt: new Date(Date.now() + DAY) });
    await createUser("Expired", { premiumExpiresAt: new Date(Date.now() - DAY) });
    const res = await request(app).get("/feed").set("Cookie", await login(a));
    expect(res.body.data[0]._id).toBe(String(p._id));
    expect(res.body.data).toHaveLength(3);
    expect(res.body.data[0].premiumExpiresAt).toBeUndefined();
  });
});

describe("razorpay checkout", () => {
  test("creates an order for the server price and reuses it on retry", async () => {
    const spy = mockCreateOrder();
    const a = await createUser("Alpha");
    const cookie = await login(a);
    const r1 = await request(app).post("/payment/create-order").set("Cookie", cookie).send({ amount: 1 });
    expect(r1.status).toBe(201);
    expect(r1.body.data.amount).toBe(10000); // client-sent amount ignored
    expect(r1.body.data.keyId).toBe("rzp_test_abc123");
    expect(JSON.stringify(r1.body)).not.toContain(KEY_SECRET);
    const r2 = await request(app).post("/payment/create-order").set("Cookie", cookie);
    expect(r2.body.data.orderId).toBe(r1.body.data.orderId);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0].amount).toBe(10000);
  });

  test("valid signature + captured payment grants 30 days once; repeat verify is idempotent", async () => {
    mockCreateOrder();
    const a = await createUser("Alpha");
    const cookie = await login(a);
    const { orderId } = (await request(app).post("/payment/create-order").set("Cookie", cookie)).body.data;
    jest.spyOn(razorpay, "fetchPayment").mockResolvedValue(rpPayment(orderId));

    const v1 = await request(app).post("/payment/verify").set("Cookie", cookie).send(checkoutResult(orderId));
    expect(v1.status).toBe(200);
    expect(v1.body.data.isPremium).toBe(true);
    const first = (await User.findById(a._id)).premiumExpiresAt.getTime();
    expect(first).toBeGreaterThan(Date.now() + 29 * DAY);

    const v2 = await request(app).post("/payment/verify").set("Cookie", cookie).send(checkoutResult(orderId));
    expect(v2.status).toBe(200);
    expect((await User.findById(a._id)).premiumExpiresAt.getTime()).toBe(first);
  });

  test("bad signature, someone else's order, and amount mismatch never grant Premium", async () => {
    mockCreateOrder();
    const [a, b] = [await createUser("Alpha"), await createUser("Bravo")];
    const [ca, cb] = [await login(a), await login(b)];
    const { orderId } = (await request(app).post("/payment/create-order").set("Cookie", ca)).body.data;

    const forged = { ...checkoutResult(orderId), razorpay_signature: "0".repeat(64) };
    expect((await request(app).post("/payment/verify").set("Cookie", ca).send(forged)).status).toBe(400);
    expect((await request(app).post("/payment/verify").set("Cookie", cb).send(checkoutResult(orderId))).status).toBe(404);

    jest.spyOn(razorpay, "fetchPayment").mockResolvedValue(rpPayment(orderId, { amount: 100 }));
    const res = await request(app).post("/payment/verify").set("Cookie", ca).send(checkoutResult(orderId));
    expect(res.status).toBe(202);
    expect((await User.findById(a._id)).premiumExpiresAt).toBeNull();
    expect((await request(app).post("/payment/verify").set("Cookie", ca).send({})).status).toBe(400);
  });

  test("authorized (not captured) payment is pending; Razorpay outage is pending too", async () => {
    mockCreateOrder();
    const a = await createUser("Alpha");
    const cookie = await login(a);
    const { orderId } = (await request(app).post("/payment/create-order").set("Cookie", cookie)).body.data;
    jest.spyOn(razorpay, "fetchPayment").mockResolvedValue(rpPayment(orderId, { status: "authorized" }));
    let res = await request(app).post("/payment/verify").set("Cookie", cookie).send(checkoutResult(orderId));
    expect(res.status).toBe(202);
    expect(res.body.data.status).toBe("pending");

    razorpay.fetchPayment.mockRejectedValue(new Error("network"));
    res = await request(app).post("/payment/verify").set("Cookie", cookie).send(checkoutResult(orderId));
    expect(res.status).toBe(202);
    expect((await User.findById(a._id)).premiumExpiresAt).toBeNull();
  });

  test("status check reconciles with Razorpay when the webhook was missed", async () => {
    mockCreateOrder();
    const a = await createUser("Alpha");
    const cookie = await login(a);
    const { orderId } = (await request(app).post("/payment/create-order").set("Cookie", cookie)).body.data;
    jest.spyOn(razorpay, "fetchOrderPayments").mockResolvedValue({ items: [rpPayment(orderId)] });
    const res = await request(app).get(`/payment/status/${orderId}`).set("Cookie", cookie);
    expect(res.body.data.premiumActivated).toBe(true);
    expect(res.body.data.isPremium).toBe(true);
  });

  test("buying again while active extends from the current end date", async () => {
    mockCreateOrder();
    const end = new Date(Date.now() + 10 * DAY);
    const a = await createUser("Alpha", { premiumExpiresAt: end });
    const cookie = await login(a);
    const { orderId } = (await request(app).post("/payment/create-order").set("Cookie", cookie)).body.data;
    jest.spyOn(razorpay, "fetchPayment").mockResolvedValue(rpPayment(orderId));
    await request(app).post("/payment/verify").set("Cookie", cookie).send(checkoutResult(orderId));
    expect((await User.findById(a._id)).premiumExpiresAt.getTime()).toBe(end.getTime() + 30 * DAY);
  });
});

describe("razorpay webhook", () => {
  const sendWebhook = (body, { secret = WEBHOOK_SECRET, eventId = crypto.randomUUID() } = {}) => {
    const raw = JSON.stringify(body);
    return request(app)
      .post("/payment/webhook")
      .set("Content-Type", "application/json")
      .set("X-Razorpay-Signature", sign(raw, secret))
      .set("X-Razorpay-Event-Id", eventId)
      .send(raw);
  };

  const setupOrder = async () => {
    mockCreateOrder();
    const a = await createUser("Alpha");
    const cookie = await login(a);
    const { orderId } = (await request(app).post("/payment/create-order").set("Cookie", cookie)).body.data;
    return { a, orderId };
  };

  test("rejects a bad signature", async () => {
    const { a, orderId } = await setupOrder();
    const body = { event: "payment.captured", payload: { payment: { entity: rpPayment(orderId) } } };
    expect((await sendWebhook(body, { secret: "wrong" })).status).toBe(400);
    expect((await User.findById(a._id)).premiumExpiresAt).toBeNull();
  });

  test("payment.captured grants once; duplicate event and order.paid don't double it", async () => {
    const { a, orderId } = await setupOrder();
    const captured = { event: "payment.captured", payload: { payment: { entity: rpPayment(orderId) } } };
    const r1 = await sendWebhook(captured, { eventId: "evt_1" });
    expect(r1.status).toBe(200);
    const first = (await User.findById(a._id)).premiumExpiresAt.getTime();

    expect((await sendWebhook(captured, { eventId: "evt_1" })).body.status).toBe("duplicate");
    const paid = {
      event: "order.paid",
      payload: { payment: { entity: rpPayment(orderId) }, order: { entity: { id: orderId, amount_paid: 10000 } } },
    };
    await sendWebhook(paid, { eventId: "evt_2" });
    expect((await User.findById(a._id)).premiumExpiresAt.getTime()).toBe(first);
  });

  test("payment.failed marks the order failed without Premium", async () => {
    const { a, orderId } = await setupOrder();
    const failed = {
      event: "payment.failed",
      payload: { payment: { entity: rpPayment(orderId, { status: "failed", error_description: "Card declined" }) } },
    };
    await sendWebhook(failed);
    const p = await Payment.findOne({ orderId });
    expect(p.status).toBe("failed");
    expect(p.failureReason).toBe("Card declined");
    expect((await User.findById(a._id)).premiumExpiresAt).toBeNull();
  });
});

describe("calls", () => {
  const socketFor = (cookie) =>
    new Promise((resolve, reject) => {
      const s = ioClient(baseUrl, { extraHeaders: { cookie }, transports: ["websocket"], forceNew: true });
      s.on("connect", () => resolve(s));
      s.on("connect_error", reject);
    });
  const next = (socket, event) => new Promise((r) => socket.once(event, r));

  const pair = async ({ premium = false } = {}) => {
    const a = await createUser("Alpha", premium ? { premiumExpiresAt: new Date(Date.now() + DAY) } : {});
    const b = await createUser("Bravo");
    await connect(a, b);
    const [sa, sb] = [await socketFor(await login(a)), await socketFor(await login(b))];
    return { a, b, sa, sb };
  };

  test("free users can audio call: ring, accept, signal, end", async () => {
    const { a, b, sa, sb } = await pair();
    const incoming = next(sb, "call:incoming");
    const start = await sa.emitWithAck("call:start", { toUserId: String(b._id), kind: "audio" });
    expect(start.ok).toBe(true);
    const inc = await incoming;
    expect(inc.from._id).toBe(String(a._id));
    expect(inc.from.emailId).toBeUndefined();

    const accepted = next(sa, "call:accepted");
    expect((await sb.emitWithAck("call:accept", { callId: inc.callId })).ok).toBe(true);
    await accepted;

    const signal = next(sb, "call:signal");
    sa.emit("call:signal", { callId: start.callId, data: { type: "offer", sdp: "v=0 test", extra: "x" } });
    expect((await signal).data).toEqual({ type: "offer", sdp: "v=0 test", iceRestart: false });

    const ended = next(sb, "call:ended");
    sa.emit("call:end", { callId: start.callId });
    expect((await ended).reason).toBe("ended");
    sa.close();
    sb.close();
  });

  test("a call that couldn't connect ends with reason failed for both sides", async () => {
    const { b, sa, sb } = await pair();
    const incoming = next(sb, "call:incoming");
    const start = await sa.emitWithAck("call:start", { toUserId: String(b._id), kind: "audio" });
    const inc = await incoming;
    expect((await sb.emitWithAck("call:accept", { callId: inc.callId })).ok).toBe(true);
    const endedA = next(sa, "call:ended");
    const endedB = next(sb, "call:ended");
    sa.emit("call:end", { callId: start.callId, reason: "failed" });
    expect((await endedA).reason).toBe("failed");
    expect((await endedB).reason).toBe("failed");
    sa.close();
    sb.close();
  });

  test("video needs Premium for the caller only", async () => {
    let { b, sa, sb } = await pair();
    const free = await sa.emitWithAck("call:start", { toUserId: String(b._id), kind: "video" });
    expect(free.reason).toBe("premium_required");
    sa.close();
    sb.close();
    await Promise.all([User, connectionRequest].map((m) => m.deleteMany({})));

    ({ b, sa, sb } = await pair({ premium: true }));
    const incoming = next(sb, "call:incoming");
    const ok = await sa.emitWithAck("call:start", { toUserId: String(b._id), kind: "video" });
    expect(ok.ok).toBe(true);
    expect((await incoming).kind).toBe("video");
    expect((await sb.emitWithAck("call:accept", { callId: ok.callId })).ok).toBe(true); // free callee accepts
    sa.close();
    sb.close();
  });

  test("strangers, offline and busy users; rejection; timeout", async () => {
    const { a, b, sa, sb } = await pair();
    const c = await createUser("Charlie");
    expect((await sa.emitWithAck("call:start", { toUserId: String(c._id), kind: "audio" })).reason).toBe("not_allowed");
    const d = await createUser("Delta");
    await connect(a, d);
    expect((await sa.emitWithAck("call:start", { toUserId: String(d._id), kind: "audio" })).reason).toBe("offline");

    // Bravo rejects
    const inc = next(sb, "call:incoming");
    const s1 = await sa.emitWithAck("call:start", { toUserId: String(b._id), kind: "audio" });
    const ended = next(sa, "call:ended");
    sb.emit("call:reject", { callId: (await inc).callId });
    expect((await ended).reason).toBe("rejected");
    expect(s1.ok).toBe(true);

    // Delta (online now) calls Alpha while Alpha rings Bravo -> busy
    const sd = await socketFor(await login(d));
    await sa.emitWithAck("call:start", { toUserId: String(b._id), kind: "audio" });
    expect((await sd.emitWithAck("call:start", { toUserId: String(a._id), kind: "audio" })).reason).toBe("busy");
    // ...and the ringing call times out
    expect((await next(sa, "call:ended")).reason).toBe("timeout");
    sa.close();
    sb.close();
    sd.close();
  });

  test("an outsider can't accept, signal or end someone else's call", async () => {
    const { b, sa, sb } = await pair();
    const a = await User.findOne({ firstName: "Alpha" });
    const e = await createUser("Echo");
    await connect(e, a);
    const se = await socketFor(await login(e));
    const inc = next(sb, "call:incoming");
    await sa.emitWithAck("call:start", { toUserId: String(b._id), kind: "audio" });
    const { callId } = await inc;
    expect((await se.emitWithAck("call:accept", { callId })).ok).toBe(false);
    se.emit("call:end", { callId });
    expect((await sb.emitWithAck("call:accept", { callId })).ok).toBe(true);
    let leaked = false;
    sb.once("call:signal", () => (leaked = true));
    se.emit("call:signal", { callId, data: { type: "offer", sdp: "evil" } });
    await new Promise((r) => setTimeout(r, 150));
    expect(leaked).toBe(false);
    sa.close();
    sb.close();
    se.close();
  });

  test("a dropped side can resume; otherwise the call ends after the grace period", async () => {
    const { a, b, sa, sb } = await pair();
    const inc = next(sb, "call:incoming");
    const { callId } = await sa.emitWithAck("call:start", { toUserId: String(b._id), kind: "audio" });
    await inc;
    await sb.emitWithAck("call:accept", { callId });

    const cookieA = await login(a);
    const reconnecting = next(sb, "call:peer-reconnecting");
    sa.close();
    await reconnecting;
    const sa2 = await socketFor(cookieA);
    expect((await sa2.emitWithAck("call:resume", { callId })).ok).toBe(true);

    const ended = next(sa2, "call:ended");
    sb.close();
    expect((await ended).reason).toBe("disconnected");
    sa2.close();
  });

  test("ICE servers: STUN by default, short-lived TURN credentials with a secret", async () => {
    const a = await createUser("Alpha");
    const cookie = await login(a);
    let res = await request(app).get("/call/ice-servers").set("Cookie", cookie);
    expect(res.body.data.turnConfigured).toBe(false);
    expect(res.body.data.iceServers[0].urls[0]).toMatch(/^stun:/);

    process.env.TURN_URLS = "turn:turn.example.com:3478";
    process.env.TURN_SECRET = "turn-secret";
    res = await request(app).get("/call/ice-servers").set("Cookie", cookie);
    const turn = res.body.data.iceServers[1];
    const [expiry, uid] = turn.username.split(":");
    expect(uid).toBe(String(a._id));
    expect(Number(expiry)).toBeGreaterThan(Date.now() / 1000);
    expect(turn.credential).toBe(crypto.createHmac("sha1", "turn-secret").update(turn.username).digest("base64"));
    expect(JSON.stringify(res.body)).not.toContain("turn-secret");
    delete process.env.TURN_URLS;
    delete process.env.TURN_SECRET;
    expect((await request(app).get("/call/ice-servers")).status).toBe(401);
  });
});
