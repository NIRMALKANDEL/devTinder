# DevTinder — Backend

REST API for **DevTinder**, a Tinder-style app where developers discover and connect with each other.

Frontend repo: [NIRMALKANDEL/devTinder-web](https://github.com/NIRMALKANDEL/devTinder-web) · Live site: https://www.projectdev.in

## Features

- **Sign up / Login / Logout** with JWT stored in an httpOnly cookie
- **Email verification** — signup sends a welcome email with a verification link; clicking it verifies the email and logs the user in. Login is blocked until the email is verified (a fresh link is sent if they try)
- **Retype password** check on signup and on password reset
- **Forgot / reset password** — emails a one-time reset link valid for 15 minutes
- **Emails** (AWS SES) — welcome + verify, password reset, "someone is interested in you", "your request was accepted"
- **Profile** view / edit (skills, portfolio URL, GitHub URL, photo, about…). `githubUrl` is optional and must be a github.com link
- **Feed** of developers you haven't interacted with yet
- **Connection requests** — send (ignored / interested) and review (accepted / rejected). One active request per pair of users, enforced by a unique index
- **Real-time chat** (Socket.IO) between connections, with typing indicator and paged history
- **Block / unblock and report** users (reports can be emailed to the admin)
- **Delete account** (password required) — removes the user's requests, chats, messages and reports
- **Feed skill filter** — `GET /feed?skills=react,node` (case-insensitive)
- **Security** — rate limits on login (per IP and per account), signup and forgot-password; helmet headers; `secure` + `SameSite=Lax` cookie; changing or resetting the password logs out every other session
- **Background email queue** — emails never slow down API requests; retries, rate cap and duplicate protection

## Tech Stack

- Node.js + [Express 4](https://expressjs.com/)
- MongoDB Atlas + [Mongoose 8](https://mongoosejs.com/)
- [jsonwebtoken](https://github.com/auth0/node-jsonwebtoken), [bcryptjs](https://github.com/dcodeIO/bcrypt.js), [validator](https://github.com/validatorjs/validator.js)
- [AWS SDK v3 — SES client](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/ses/) for sending email

## Project Structure

```
src/
├── app.js                    # Express app, routers, DB connect, server start
├── config/Database.js        # MongoDB connection
├── middlewares/auth.js       # userAuth — reads JWT cookie, loads req.user
├── models/
│   ├── user.js               # User schema (+ email verification / reset fields)
│   └── connectionRequest.js
├── routes/
│   ├── auth.js               # signup, login, logout, verify-email, forgot/reset password
│   ├── profile.js
│   ├── request.js            # send / review connection requests (+ emails)
│   └── user.js               # feed, connections, received requests
└── utils/
    ├── sesClient.js          # AWS SES client (region ap-south-1)
    ├── sendEmail.js          # email templates + sending helpers
    └── validation.js         # signup / password / profile-edit validation
```

## API

| Method | Route | Auth | Description |
| --- | --- | --- | --- |
| POST | `/signup` | – | Create account (`firstName, lastName, emailId, password, confirmPassword`), sends welcome + verify email |
| GET | `/verify-email/:token` | – | Verifies the email, logs the user in (sets the cookie) and redirects to `FRONTEND_URL/profile`; invalid/used link → `/login?verified=false` |\|false` |
| POST | `/login` | – | Login (`emailId, password`); blocked until email is verified |
| POST | `/logout` | – | Clears the cookie |
| POST | `/forgot-password` | – | Emails a reset link (`emailId`); same reply whether or not the email exists |
| POST | `/reset-password/:token` | – | Set a new password (`password, confirmPassword`) |
| GET | `/profile/view` | ✔ | Logged-in user's profile |
| PATCH | `/profile/edit` | ✔ | Edit profile fields (`firstName`, `lastName`, `age`, `gender`, `photoURL`, `about`, `skills`, `portfolioUrl`, `githubUrl`) |
| POST | `/request/send/:status/:toUserId` | ✔ | `status` = `ignored` \| `interested` (interested emails the other user) |
| POST | `/request/review/:status/:requestId` | ✔ | `status` = `accepted` \| `rejected` (accepted emails the sender) |
| GET | `/user/requests/received` | ✔ | Pending requests sent to you |
| GET | `/user/connections` | ✔ | Your connections |
| GET | `/feed` | ✔ | Profiles to swipe on (`?skills=a,b` to filter) |
| PUT | `/profile/password` | ✔ | Change password (`oldPassword, newPassword`); logs out other sessions |
| DELETE | `/profile` | ✔ | Delete account (`password`) |
| POST / DELETE | `/user/block/:userId` | ✔ | Block / unblock a user |
| GET | `/user/blocked` | ✔ | Users you blocked |
| POST | `/user/report/:userId` | ✔ | Report (`reason`: spam, harassment, fake_profile, inappropriate_content, other; optional `details`, `block`) |
| GET | `/chats` | ✔ | Your conversations, newest first |
| GET | `/chat/:userId` | ✔ | Messages with a connection (`?before=<messageId>` for older) |
| GET | `/health` | – | `{ status: "ok" }` when the API and database are up (for uptime monitors) |
| GET | `/premium/plan` | – | Premium price/duration from `.env`, and whether checkout is on |
| GET | `/premium/status` | ✔ | Your Premium state and last 5 payments |
| GET | `/premium/recommendations` | ✔ Premium | Up to 5 daily picks by shared skills (403 `PREMIUM_REQUIRED` otherwise) |
| POST | `/payment/create-order` | ✔ | Creates (or reuses, for 15 min) a Razorpay order for the server-side price |
| POST | `/payment/verify` | ✔ | Checkout result (`razorpay_order_id, razorpay_payment_id, razorpay_signature`): checks the signature, then asks Razorpay; 200 active, 202 pending, 402 failed |
| GET | `/payment/status/:orderId` | ✔ | Order status; reconciles with Razorpay if not settled yet |
| POST | `/payment/webhook` | signature | Razorpay webhook (`payment.captured`, `payment.authorized`, `payment.failed`, `order.paid`), raw-body HMAC check, duplicate events ignored |
| GET | `/call/ice-servers` | ✔ | STUN/TURN servers for calls, with short-lived TURN credentials |

**Socket.IO** (path `/socket.io`, through nginx at `/api/socket.io`, authenticated by the login cookie): emit `sendMessage {toUserId, text}` (with ack), `typing {toUserId}`; listen for `messageReceived`, `typing`.

**Calls (Socket.IO signaling, `src/calls.js`)**: emit `call:start {toUserId, kind: "audio"|"video"}` (ack `{ok, callId}` or `{ok:false, reason}`: `not_allowed`, `premium_required`, `offline`, `busy`, `already_in_call`, `rate_limited`), `call:accept {callId}` (ack), `call:reject {callId, reason}`, `call:end {callId}`, `call:signal {callId, data}` (offer/answer/candidate), `call:resume {callId}` (ack, after a reconnect). Listen for `call:incoming`, `call:accepted`, `call:signal`, `call:ended {reason}`, `call:handled-elsewhere`, `call:peer-reconnecting`, `call:peer-reconnected`. Only accepted, unblocked connections can call; audio is free, starting video needs Premium. Call state is in memory (fine for one pm2 instance).

All errors are JSON: `{ "message": "..." }`. Auth failures are `401`.

> Users created before email verification existed have no `isEmailVerified` value and are treated as verified, so they can still log in.

## Environment Variables

Create `devTinder/.env` (it is git-ignored — never commit it):

```env
MONGODB_URI=<your MongoDB Atlas connection string>
JWT_SECRET=<long random string>
PORT=7777

# AWS SES (IAM user keys — see "AWS setup" below)
AWS_SES_ACCESS_KEY_ID=<IAM access key id>
AWS_SES_SECRET_ACCESS_KEY=<IAM secret access key>
SES_FROM_EMAIL=no-reply@projectdev.in
# AWS_REGION=ap-south-1          # optional, ap-south-1 is the default

# Where the frontend lives — used to build links inside emails
FRONTEND_URL=http://localhost:5173   # production: https://www.projectdev.in

# Optional, for testing only: send EVERY email to this one address
# EMAIL_DEMO_RECIPIENT=you@example.com

# Proxies in front of the API. nginx = 1 (Cloudflare adds the visitor IP header itself).
# Wrong value = all users share one rate-limit bucket, or IPs can be spoofed.
TRUST_PROXY=1
CORS_ORIGINS=http://localhost:5173   # comma-separated
REPORTS_EMAIL=                       # optional: where user reports are emailed
ENABLE_CRON=true                     # false on dev machines that use the production DB
```

## Getting Started (local)

```bash
git clone https://github.com/NIRMALKANDEL/devTinder.git
cd devTinder
npm install
# create .env as above
npm run dev        # nodemon, http://localhost:7777
```

**Without touching production data:** `npm run dev:memory` starts the API on a throwaway in-memory MongoDB with demo users (login `aarav@example.com` / `Dev@12345`) and logs emails instead of sending them.

**Tests:** `npm test` runs the Jest + Supertest API tests (in-memory MongoDB, no real email).

Run the [frontend](https://github.com/NIRMALKANDEL/devTinder-web) with `npm run dev` (http://localhost:5173) — its Vite proxy forwards `/api/*` to this backend.

**MongoDB Atlas:** your machine's public IP must be in Atlas → *Network Access*, otherwise the server logs `Could not connect to any servers in your MongoDB Atlas cluster`.

## Email setup — how the pieces fit together

```
User's browser ──► Cloudflare (DNS + proxy) ──► EC2 (nginx ─► Node/Express) ──► AWS SES ──► user's inbox
                     ▲                                                          │
GoDaddy (domain registrar, nameservers → Cloudflare)            DKIM CNAMEs in Cloudflare prove
                                                                 mail from @projectdev.in is genuine
```

### 1. Domain — GoDaddy

- `projectdev.in` is registered at **GoDaddy**.
- In GoDaddy → *Domain* → *Nameservers*, the nameservers are changed to Cloudflare's (`clark.ns.cloudflare.com`, `olivia.ns.cloudflare.com`). After that, **all DNS records are managed in Cloudflare**, not GoDaddy.

### 2. DNS — Cloudflare

| Type | Name | Value | Proxy |
| --- | --- | --- | --- |
| A | `projectdev.in` / `www` | EC2 public IP (Elastic IP recommended) | Proxied (orange cloud) |
| CNAME ×3 | `<token>._domainkey` | `<token>.dkim.amazonses.com` | **DNS only** (grey cloud) |

- The 3 DKIM CNAMEs come from **SES → Identities → projectdev.in → DKIM**. They must be *DNS only* — proxied CNAMEs break DKIM verification.
- Optional but recommended for inbox placement: a DMARC record, e.g. `TXT _dmarc` → `v=DMARC1; p=none;`.

### 3. AWS SES (region **ap-south-1**, Mumbai)

1. **SES → Identities → Create identity → Domain** → `projectdev.in`, with Easy DKIM. Add the 3 CNAMEs in Cloudflare → status becomes *Verified*.
2. Send from any address on that domain — we use `no-reply@projectdev.in` (`SES_FROM_EMAIL`).
   Sending *from* a `@gmail.com` address through SES lands in Spam / Sent, so always use the domain.
3. **Sandbox vs production:** new SES accounts are in the *sandbox* — you can only send **to verified addresses**, max 200/day. Request **production access** (SES → Account dashboard → *Request production access*, mail type *Transactional*) to email real users. AWS may ask follow-up questions in a support case (website, email types, volume, how users opt in, bounce handling, sample email).
4. **Suppression list:** SES → *Suppression list* → account-level suppression enabled for *Bounces and complaints*.

### 4. AWS IAM

SES is called with an **IAM user's access keys** (IAM is global — the same user works in every region):

1. IAM → *Users* → *Create user* (e.g. `devtinder-ses`), no console access.
2. Attach a policy that allows sending email, e.g. `AmazonSESFullAccess`, or a minimal custom policy with `ses:SendEmail` / `ses:SendRawEmail`.
3. *Security credentials* → *Create access key* → put them in `.env` as `AWS_SES_ACCESS_KEY_ID` / `AWS_SES_SECRET_ACCESS_KEY`.
4. Never commit the keys; rotate them if they ever leak.

## Premium and Razorpay

- Price and duration: `PREMIUM_PRICE_PAISE` (10000 = ₹100) and `PREMIUM_DURATION_DAYS` (30). Leave the price empty to keep checkout off.
- Keys: `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` from Razorpay Dashboard → Account & Settings → API Keys. Use `rzp_test_...` keys until the account is approved and live keys are generated. The secret never leaves the server.
- Webhook: Dashboard → Webhooks → Add: URL `https://www.projectdev.in/api/payment/webhook`, a secret of your choice (put the same value in `RAZORPAY_WEBHOOK_SECRET`), events `payment.captured`, `payment.failed`, `payment.authorized`, `order.paid`. Test mode and live mode have separate webhooks.
- Turn on automatic capture (Dashboard → Account & Settings → Payment capture), so payments go from authorized to captured without manual action.
- Premium is granted only after a verified, captured payment whose order id, amount and currency match our record (`utils/premium.js` `grantPremium`, once per order; buying again extends the end date).
- Refund: issue it in the Razorpay dashboard, then remove Premium by hand: in MongoDB set `premiumExpiresAt` to `null` on that user (or to the end date before the refunded payment).
- Payments are stored in the `payments` collection, processed webhook ids in `webhookevents` (kept 90 days).

## Calls (WebRTC)

- Signaling runs over the existing Socket.IO connection; audio/video go peer to peer. Calls need HTTPS (already the case behind Cloudflare).
- STUN alone fails on many mobile/office networks, so set up TURN before launch:
  - **Own coturn** (e.g. a small separate server near India): `use-auth-secret`, `static-auth-secret=<TURN_SECRET>`, `realm=projectdev.in`, listen on 3478 (UDP+TCP) and 5349 (TLS), open the relay port range (e.g. 49152–65535/UDP) in the security group. Put the hostnames in `TURN_URLS` and the secret in `TURN_SECRET`. Credentials given to browsers expire after `TURN_TTL_SECONDS`.
  - **Hosted TURN** (Twilio, Metered, Cloudflare Calls, etc.): put its URLs in `TURN_URLS` and fixed credentials in `TURN_USERNAME` / `TURN_CREDENTIAL`.
- Do not point a TURN hostname at Cloudflare's proxy (orange cloud): TURN is not HTTP; use a DNS-only record.
- `CALL_FORCE_RELAY=true` sends all media through TURN, which hides users' IP addresses from each other (costs more TURN bandwidth).
- Nothing is recorded and no call history is stored.

## Deployment (AWS EC2 + pm2 + nginx)

The backend runs on the same EC2 instance as the frontend, under **pm2**, on port `7777`. nginx forwards `https://www.projectdev.in/api/*` → `http://localhost:7777/*`.

### Deploying an update — step by step

```bash
# 1. Connect to the server
ssh -i <your-key>.pem ubuntu@<your-ec2-host>

# 2. Get the latest code
cd ~/devTinder
git pull origin main

# 3. Install new dependencies (this release adds @aws-sdk/client-ses)
npm install

# 4. First time after this release: add the new variables to the server's .env
nano .env
#   SES_FROM_EMAIL=no-reply@projectdev.in
#   FRONTEND_URL=https://www.projectdev.in
#   AWS_SES_ACCESS_KEY_ID=...
#   AWS_SES_SECRET_ACCESS_KEY=...
#   (make sure EMAIL_DEMO_RECIPIENT is NOT set in production)

# 5. Restart the API (find the process name with `pm2 list`)
pm2 list
pm2 restart <name-or-id> --update-env

# 6. Check it started cleanly
pm2 logs <name-or-id> --lines 30
#   expect: "Database connection established" and "Server is successfully listening on port 7777..."
```

**EC2 public IP → Atlas:** the EC2 instance's IP must also be in MongoDB Atlas → *Network Access*. Use an **Elastic IP** so it doesn't change on reboot.

Then deploy the frontend — see the [frontend README](https://github.com/NIRMALKANDEL/devTinder-web#deploying-an-update).

### This release (chat, security, blocking) — extra one-time steps

1. `npm install` in **both** repos (new: socket.io, helmet, express-rate-limit; frontend: three, @react-three/fiber, @react-three/drei, socket.io-client).
2. Server `.env`: add `TRUST_PROXY` and optionally `REPORTS_EMAIL=you@...`. First check the real nginx config:
   `grep -rn "X-Forwarded-For" /etc/nginx/sites-enabled/`
   - no match (nginx passes Cloudflare's header through, like the example config) → `TRUST_PROXY=1`
   - `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;` → `TRUST_PROXY=2`

   Check it worked: after a few logins, rate-limit buckets must be per visitor (one person hitting the limit must not lock out everyone).
3. Run the migration once: `npm run migrate:pair-keys` (fills `pairKey` on old connection requests; safe to re-run).
4. nginx: add the WebSocket block for chat **above** `location /api/`, then `sudo nginx -t && sudo systemctl reload nginx`:
   ```nginx
   location /api/socket.io/ {
       proxy_pass http://localhost:7777/socket.io/;
       proxy_http_version 1.1;
       proxy_set_header Upgrade $http_upgrade;
       proxy_set_header Connection "upgrade";
       proxy_set_header Host $host;
       proxy_read_timeout 3600s;
   }
   ```
   Without it chat works locally but not on the live site.
5. Recommended: allow ports 80/443 on the EC2 security group **only from [Cloudflare's IP ranges](https://www.cloudflare.com/ips/)**, so nobody can bypass Cloudflare and fake their IP to dodge rate limits.

`scripts/deploy-server.sh` does steps 1–3 plus the usual pull / build / restart for both repos (run it on the server).

### Smoke test after deploying

1. Sign up on https://www.projectdev.in with a real inbox → welcome email arrives → click *Verify my email* → *Email verified! You can now login.*
2. Login → *Forgot password?* → reset email → set a new password → login with it.
3. Click *Interested* on someone in the feed → they get an email.

If emails don't arrive: check `pm2 logs` for `Email rejected by SES` (usually sandbox mode / unverified recipient) and the recipient's Spam folder.
