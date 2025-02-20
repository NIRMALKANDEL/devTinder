const adminAuth = (req, res, next) => {
  const token = "xyz";
  const isAdminAuthorised = token === "xyz";
  if (!isAdminAuthorised) {
    res.status(401).send("unauthorised admin");
  } else {
    next();
  }
};
const userAuth = (req, res, next) => {
  const token = "abc";
  const isAdminAuthorised = token === "abc";
  if (!isAdminAuthorised) {
    res.status(401).send("unauthorised user");
  } else {
    next();
  }
};

module.exports = { adminAuth, userAuth };
