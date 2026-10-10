// One place for the login cookie's options, so login, verify-email, password
// change and logout always agree (a cookie is only cleared with matching options).
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// secure follows the request: true behind HTTPS (Cloudflare sends
// X-Forwarded-Proto: https, read via "trust proxy"), false on plain-http localhost
const cookieOptions = (req) => ({
  httpOnly: true,
  secure: req.secure,
  sameSite: "lax",
  path: "/",
});

const setAuthCookie = (req, res, token) =>
  res.cookie("token", token, {
    ...cookieOptions(req),
    expires: new Date(Date.now() + ONE_DAY_MS),
  });

const clearAuthCookie = (req, res) => res.clearCookie("token", cookieOptions(req));

module.exports = { setAuthCookie, clearAuthCookie };
