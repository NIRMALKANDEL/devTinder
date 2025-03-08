const jwt = require("jsonwebtoken");

const { User } = require("../models/user");

const userAuth = async (req, res, next) => {
  // read the token from the req cookies
  try {
    const { token } = req.cookies;

    if (!token) {
      return res.status(401).send("you are not logged in please loging first");
    }
    // validate the token
    const decodedObj = await jwt.verify(token, "@devTinder001");
    // and find the user and the availability
    const { _id } = decodedObj;
    const user = await User.findById(_id);
    if (!user) {
      throw new Error("user not found");
    }
    req.user = user;
    next();
  } catch (err) {
    res.status(400).send("ERROE" + err.message);
  }
};

module.exports = { userAuth };
