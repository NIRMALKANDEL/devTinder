const express = require("express");

const requestRouter = express.Router();
const { userAuth } = require("../middlewares/auth");
requestRouter.post("/sendConnectionRequest", userAuth, async (req, res) => {});

module.exports = requestRouter;
