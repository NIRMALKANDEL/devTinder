# DevTinderAPI

authRouter

- POST / signup
- POST /Login
- POST /logout

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
