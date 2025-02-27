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

- POST /request/send/intereted/:userId
- POST /request/send/ignored/:userId
- POST /request/review/accepted/:requestId
- POST /request/review/rejected/:requestId

userRouter

- GET user/connections
- GET user/requests/received/
- GET /

  Status: ignore, interested, accepeted, rejected
