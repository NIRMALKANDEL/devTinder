// API tests against a throwaway in-memory MongoDB. No real email is sent.
const http = require("http");
const { MongoMemoryServer } = require("mongodb-memory-server");
const mongoose = require("mongoose");
const request = require("supertest");
const { io: ioClient } = require("socket.io-client");

let mongo, app, server, baseUrl, User, connectionRequest, Report, Chat, Message;
let ipCounter = 0;
// Each test call gets its own client IP, so the per-IP limiters don't interfere
const nextIp = () => `10.0.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`;

const PASSWORD = "Dev@12345";

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

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongo.getUri("test");
  process.env.JWT_SECRET = "test-secret";
  process.env.EMAIL_DRY_RUN = "true";
  process.env.ENABLE_CRON = "false";
  delete process.env.REPORTS_EMAIL;
  jest.spyOn(console, "log").mockImplementation(() => {});

  ({ app } = require("../src/app"));
  ({ User } = require("../src/models/user"));
  ({ connectionRequest } = require("../src/models/connectionRequest"));
  ({ Report } = require("../src/models/report"));
  ({ Chat, Message } = require("../src/models/chat"));
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
  await Promise.all(
    [User, connectionRequest, Report, Chat, Message].map((m) => m.deleteMany({}))
  );
});

describe("health and errors", () => {
  test("GET /health reports ok", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });

  test("unknown route and oversized body return JSON errors", async () => {
    expect((await request(app).get("/nope")).body).toEqual({ message: "Not found" });
    const big = await request(app)
      .patch("/profile/edit")
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ about: "x".repeat(1.2 * 1024 * 1024) }));
    expect(big.status).toBe(413);
    expect(big.body.message).toMatch(/too large/);
  });

  test("security headers are set", async () => {
    const res = await request(app).get("/health");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });
});

describe("auth", () => {
  test("not logged in -> 401 JSON", async () => {
    const res = await request(app).get("/profile/view");
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/login/i);
  });

  test("login cookie is httpOnly + SameSite=Lax, Secure only over https", async () => {
    const user = await createUser("Cookie");
    const plain = await request(app).post("/login").set("X-Forwarded-For", nextIp())
      .send({ emailId: user.emailId, password: PASSWORD });
    const cookie = plain.headers["set-cookie"][0];
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).not.toMatch(/Secure/);
    expect(plain.body.payload.password).toBeUndefined();

    const https = await request(app).post("/login").set("X-Forwarded-For", nextIp())
      .set("X-Forwarded-Proto", "https").send({ emailId: user.emailId, password: PASSWORD });
    expect(https.headers["set-cookie"][0]).toMatch(/Secure/);
  });

  test("changing the password logs out old sessions but keeps this one", async () => {
    const user = await createUser("Changer");
    const oldCookie = await login(user);
    // the new token's iat must land in a later second than the old one
    await new Promise((r) => setTimeout(r, 1100));
    const res = await request(app).put("/profile/password").set("Cookie", oldCookie)
      .send({ oldPassword: PASSWORD, newPassword: "New@12345" });
    expect(res.status).toBe(200);
    const newCookie = res.headers["set-cookie"][0].split(";")[0];

    expect((await request(app).get("/profile/view").set("Cookie", oldCookie)).status).toBe(401);
    expect((await request(app).get("/profile/view").set("Cookie", newCookie)).status).toBe(200);
  });

  test("logout clears the cookie", async () => {
    const user = await createUser("Leaver");
    const cookie = await login(user);
    const res = await request(app).post("/logout").set("Cookie", cookie);
    expect(res.headers["set-cookie"][0]).toMatch(/token=;.*Expires=Thu, 01 Jan 1970/);
  });

  test("signup returns JSON errors", async () => {
    const res = await request(app).post("/signup").set("X-Forwarded-For", nextIp())
      .send({ firstName: "Abcd", lastName: "Ef", emailId: "bad", password: "x", confirmPassword: "x" });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Invalid email address");
  });
});

describe("rate limits", () => {
  test("10 failed logins lock that account, even from different IPs", async () => {
    const user = await createUser("Target");
    for (let i = 0; i < 10; i++) {
      const res = await request(app).post("/login").set("X-Forwarded-For", nextIp())
        .send({ emailId: user.emailId, password: "Wrong@123" });
      expect(res.status).toBe(400);
    }
    const locked = await request(app).post("/login").set("X-Forwarded-For", nextIp())
      .send({ emailId: user.emailId, password: PASSWORD });
    expect(locked.status).toBe(429);
    expect(locked.body.message).toMatch(/Too many failed login attempts/);
  });

  test("forgot-password is limited per IP, and different IPs have separate buckets", async () => {
    const ip = nextIp();
    const statuses = [];
    for (let i = 0; i < 6; i++) {
      statuses.push((await request(app).post("/forgot-password").set("X-Forwarded-For", ip)
        .send({ emailId: "nobody@example.com" })).status);
    }
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
    const other = await request(app).post("/forgot-password").set("X-Forwarded-For", nextIp())
      .send({ emailId: "nobody@example.com" });
    expect(other.status).toBe(200);
  });
});

describe("connection requests", () => {
  test("double click creates only one request, reverse direction is refused", async () => {
    const [a, b] = [await createUser("Alpha"), await createUser("Bravo")];
    const [ca, cb] = [await login(a), await login(b)];
    const results = await Promise.all(
      [1, 2, 3].map(() => request(app).post(`/request/send/interested/${b._id}`).set("Cookie", ca))
    );
    expect(results.map((r) => r.status).sort()).toEqual([201, 400, 400]);
    expect(await connectionRequest.countDocuments()).toBe(1);

    const reverse = await request(app).post(`/request/send/interested/${a._id}`).set("Cookie", cb);
    expect(reverse.status).toBe(400);
  });

  test("connections skip deleted users instead of failing", async () => {
    const [a, b, c] = [await createUser("Alpha"), await createUser("Bravo"), await createUser("Charlie")];
    await connect(a, b);
    await connect(c, a);
    await User.deleteOne({ _id: c._id });
    const res = await request(app).get("/user/connections").set("Cookie", await login(a));
    expect(res.status).toBe(200);
    expect(res.body.data.map((u) => u.firstName)).toEqual(["Bravo"]);
  });

  test("invalid user id returns 400 not 500", async () => {
    const a = await createUser("Alpha");
    const res = await request(app).post("/request/send/interested/not-an-id").set("Cookie", await login(a));
    expect(res.status).toBe(400);
  });
});

describe("feed", () => {
  test("filters by skill, case-insensitively", async () => {
    const me = await createUser("Viewer");
    await createUser("Reacty", { skills: ["React", "Node.js"] });
    await createUser("Gopher", { skills: ["Go"] });
    const cookie = await login(me);
    const res = await request(app).get("/feed?skills=react").set("Cookie", cookie);
    expect(res.body.data.map((u) => u.firstName)).toEqual(["Reacty"]);
    const all = await request(app).get("/feed").set("Cookie", cookie);
    expect(all.body.data).toHaveLength(2);
  });
});

describe("block and report", () => {
  test("blocking hides both ways and stops requests", async () => {
    const [a, b] = [await createUser("Alpha"), await createUser("Bravo")];
    const [ca, cb] = [await login(a), await login(b)];
    await connectionRequest.create({ fromUserId: b._id, toUserId: a._id, status: "interested" });

    expect((await request(app).post(`/user/block/${b._id}`).set("Cookie", ca)).status).toBe(200);
    expect((await request(app).get("/feed").set("Cookie", cb)).body.data).toHaveLength(0);
    expect((await request(app).get("/user/requests/received").set("Cookie", ca)).body.data).toHaveLength(0);
    expect((await request(app).post(`/request/send/interested/${a._id}`).set("Cookie", cb)).status).toBe(404);
    expect((await request(app).get("/user/blocked").set("Cookie", ca)).body.data[0].firstName).toBe("Bravo");

    await request(app).delete(`/user/block/${b._id}`).set("Cookie", ca);
    expect((await request(app).get("/user/blocked").set("Cookie", ca)).body.data).toHaveLength(0);
  });

  test("report: created once, duplicate 409, bad reason 400, optional block", async () => {
    const [a, b] = [await createUser("Alpha"), await createUser("Bravo")];
    const ca = await login(a);
    const bad = await request(app).post(`/user/report/${b._id}`).set("Cookie", ca).send({ reason: "meh" });
    expect(bad.status).toBe(400);
    const ok = await request(app).post(`/user/report/${b._id}`).set("Cookie", ca)
      .send({ reason: "spam", details: "<b>ads</b>", block: true });
    expect(ok.status).toBe(201);
    const again = await request(app).post(`/user/report/${b._id}`).set("Cookie", ca).send({ reason: "spam" });
    expect(again.status).toBe(409);
    expect((await User.findById(a._id)).blockedUsers.map(String)).toEqual([String(b._id)]);
  });
});

describe("delete account", () => {
  test("needs the password and removes everything tied to the user", async () => {
    const [a, b, c] = [await createUser("Alpha"), await createUser("Bravo"), await createUser("Charlie")];
    await connect(a, b);
    await User.updateOne({ _id: c._id }, { $push: { blockedUsers: a._id } });
    await Report.create({ reporterId: a._id, reportedUserId: b._id, reason: "spam" });
    const ca = await login(a);

    const wrong = await request(app).delete("/profile").set("Cookie", ca).send({ password: "Nope@1234" });
    expect(wrong.status).toBe(400);

    const res = await request(app).delete("/profile").set("Cookie", ca).send({ password: PASSWORD });
    expect(res.status).toBe(200);
    expect(await User.exists({ _id: a._id })).toBeNull();
    expect(await connectionRequest.countDocuments()).toBe(0);
    expect(await Report.countDocuments()).toBe(0);
    expect((await User.findById(c._id)).blockedUsers).toHaveLength(0);
    expect((await request(app).get("/profile/view").set("Cookie", ca)).status).toBe(401);
  });
});

describe("chat", () => {
  const socketFor = (cookie) =>
    new Promise((resolve, reject) => {
      const s = ioClient(baseUrl, { extraHeaders: { cookie }, transports: ["websocket"], forceNew: true });
      s.on("connect", () => resolve(s));
      s.on("connect_error", reject);
    });

  test("connected users exchange messages in real time; history is saved", async () => {
    const [a, b] = [await createUser("Alpha"), await createUser("Bravo")];
    await connect(a, b);
    const [ca, cb] = [await login(a), await login(b)];
    const [sa, sb] = [await socketFor(ca), await socketFor(cb)];

    const received = new Promise((r) => sb.once("messageReceived", r));
    const ack = await sa.emitWithAck("sendMessage", { toUserId: String(b._id), text: "  hello <b>B</b>  " });
    expect(ack.ok).toBe(true);
    expect((await received).text).toBe("hello <b>B</b>");

    const history = await request(app).get(`/chat/${a._id}`).set("Cookie", cb);
    expect(history.body.data.messages.map((m) => m.text)).toEqual(["hello <b>B</b>"]);
    const list = await request(app).get("/chats").set("Cookie", cb);
    expect(list.body.data[0].user.firstName).toBe("Alpha");
    expect(list.body.data[0].lastMessage.text).toBe("hello <b>B</b>");
    sa.close();
    sb.close();
  });

  test("strangers and blocked users can't chat; sockets need a valid cookie", async () => {
    const [a, b, c] = [await createUser("Alpha"), await createUser("Bravo"), await createUser("Charlie")];
    await connect(a, b);
    const ca = await login(a);
    const sa = await socketFor(ca);

    const stranger = await sa.emitWithAck("sendMessage", { toUserId: String(c._id), text: "hi" });
    expect(stranger.ok).toBe(false);
    expect((await request(app).get(`/chat/${c._id}`).set("Cookie", ca)).status).toBe(403);

    await request(app).post(`/user/block/${b._id}`).set("Cookie", ca);
    const blocked = await sa.emitWithAck("sendMessage", { toUserId: String(b._id), text: "hi" });
    expect(blocked.ok).toBe(false);
    sa.close();

    await expect(socketFor("token=forged")).rejects.toThrow("unauthorized");
  });

  test("socket rate limit: 11th message in 10s is refused", async () => {
    const [a, b] = [await createUser("Alpha"), await createUser("Bravo")];
    await connect(a, b);
    const sa = await socketFor(await login(a));
    const acks = [];
    for (let i = 0; i < 11; i++) {
      acks.push(await sa.emitWithAck("sendMessage", { toUserId: String(b._id), text: `m${i}` }));
    }
    expect(acks.filter((x) => x.ok)).toHaveLength(10);
    expect(acks[10].message).toMatch(/too fast/);
    sa.close();
  });
});
