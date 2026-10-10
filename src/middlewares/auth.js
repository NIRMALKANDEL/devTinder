const jwt = require("jsonwebtoken");

const { User } = require("../models/user");

// Changed: every auth failure is a 401 with a JSON { message }, so the frontend
// can tell "not logged in" apart from real errors.
const userAuth = async (req, res, next) => {
  try {
    const { token } = req.cookies;
    if (!token) {
      return res.status(401).json({ message: "Please login first." });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      return res
        .status(401)
        .json({ message: "Your session has expired. Please login again." });
    }

    const user = await User.findById(decoded._id).select("+passwordChangedAt");
    if (!user) {
      return res.status(401).json({ message: "Please login first." });
    }

    // Added: a password change/reset logs out every session started before it.
    // iat is in seconds; users who never changed their password have no date.
    if (
      user.passwordChangedAt &&
      decoded.iat < Math.floor(user.passwordChangedAt.getTime() / 1000)
    ) {
      return res
        .status(401)
        .json({ message: "Your password was changed. Please login again." });
    }

    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
};

module.exports = { userAuth };
