# DevTinderAPI

authRouter

- POST / signup
- POST /Login
- POST /logout
- GET /verify-email/:token
- POST /forgot-password
- POST /reset-password/:token

profileRouter

- GET /profile/view
- PATCH /profile/edit
- PATCH /profile/password

connectionRequestRouter

- POST /request/send/:status/:userId [ignored,interested]
- POST /request/review/:status/:requestId [accepted,rejected]

userRouter

- GET user/connections
- GET user/requests/received/
- GET /

  Status: ignore, interested, accepeted, rejected

premiumRouter

- GET /premium/plan
- GET /premium/status
- GET /premium/recommendations (Premium only)

paymentRouter

- POST /payment/create-order
- POST /payment/verify
- GET /payment/status/:orderId
- POST /payment/webhook (Razorpay, raw body)

callRouter

- GET /call/ice-servers
