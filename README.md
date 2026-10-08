# DevTinder — Backend

REST API for **DevTinder**, a Tinder-style app where developers discover and connect with each other.

Frontend repo: [NIRMALKANDEL/devTinder-web](https://github.com/NIRMALKANDEL/devTinder-web) · Live site: https://www.projectdev.in

## Features

- **Sign up / Login / Logout** with JWT stored in an httpOnly cookie
- **Email verification** — signup sends a welcome email with a verification link; clicking it verifies the email and logs the user in. Login is blocked until the email is verified (a fresh link is sent if they try)
- **Retype password** check on signup and on password reset
- **Forgot / reset password** — emails a one-time reset link valid for 15 minutes
- **Emails** (AWS SES) — welcome + verify, password reset, "someone is interested in you", "your request was accepted"
- **Profile** view / edit (skills, portfolio URL, photo, about…)
- **Feed** of developers you haven't interacted with yet
- **Connection requests** — send (ignored / interested) and review (accepted / rejected)

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
| PATCH | `/profile/edit` | ✔ | Edit profile fields |
| POST | `/request/send/:status/:toUserId` | ✔ | `status` = `ignored` \| `interested` (interested emails the other user) |
| POST | `/request/review/:status/:requestId` | ✔ | `status` = `accepted` \| `rejected` (accepted emails the sender) |
| GET | `/user/requests/received` | ✔ | Pending requests sent to you |
| GET | `/user/connections` | ✔ | Your connections |
| GET | `/feed` | ✔ | Profiles to swipe on |

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
```

## Getting Started (local)

```bash
git clone https://github.com/NIRMALKANDEL/devTinder.git
cd devTinder
npm install
# create .env as above
npm run dev        # nodemon, http://localhost:7777
```

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

### Smoke test after deploying

1. Sign up on https://www.projectdev.in with a real inbox → welcome email arrives → click *Verify my email* → *Email verified! You can now login.*
2. Login → *Forgot password?* → reset email → set a new password → login with it.
3. Click *Interested* on someone in the feed → they get an email.

If emails don't arrive: check `pm2 logs` for `Email rejected by SES` (usually sandbox mode / unverified recipient) and the recipient's Spam folder.
