const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("node:crypto");
const COOKIE = "apprankly_session";
const options = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict",
  path: "/",
  maxAge: 12 * 60 * 60 * 1000,
};
function validateAuth() {
  if (
    !process.env.JWT_SECRET ||
    process.env.JWT_SECRET.length < 32 ||
    /change_this|fallback|insecure|example/i.test(process.env.JWT_SECRET)
  )
    throw new Error("SET_STRONG_JWT_SECRET");
  if (
    !/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(
      process.env.ADMIN_PASSWORD_HASH || "",
    )
  )
    throw new Error("SET_ADMIN_PASSWORD_HASH");
  if (process.env.NODE_ENV === "production") {
    try {
      const origin = new URL(process.env.APP_ORIGIN);
      if (
        origin.protocol !== "https:" ||
        origin.origin !== process.env.APP_ORIGIN ||
        origin.username ||
        origin.password
      )
        throw new Error();
    } catch {
      throw new Error("SET_HTTPS_APP_ORIGIN");
    }
  }
}
function signingKey() {
  return crypto
    .createHmac("sha256", process.env.JWT_SECRET)
    .update(process.env.ADMIN_PASSWORD_HASH)
    .digest("hex");
}
function authenticate(req, res, next) {
  const cookie = (req.headers.cookie || "")
    .split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith(COOKIE + "="));
  if (!cookie) return res.status(401).json({ error: "AUTH_REQUIRED" });
  try {
    req.user = jwt.verify(cookie.slice(COOKIE.length + 1), signingKey(), {
      algorithms: ["HS256"],
      issuer: "apprankly",
      audience: "owner",
    });
    if (req.user.sub !== "owner") throw new Error();
    next();
  } catch {
    res.status(401).json({ error: "AUTH_REQUIRED" });
  }
}
async function loginOwner(req, res) {
  const p = req.body?.password;
  if (
    typeof p !== "string" ||
    p.length > 256 ||
    !(await bcrypt.compare(p, process.env.ADMIN_PASSWORD_HASH))
  )
    return res.status(401).json({ error: "INVALID_LOGIN" });
  const token = jwt.sign({}, signingKey(), {
    subject: "owner",
    issuer: "apprankly",
    audience: "owner",
    expiresIn: "12h",
  });
  res.cookie(COOKIE, token, options).json({ success: true });
}
function logout(req, res) {
  res
    .clearCookie(COOKIE, { ...options, maxAge: undefined })
    .json({ success: true });
}
function sameOrigin(req, res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const expected =
    process.env.APP_ORIGIN || `http://localhost:${process.env.PORT || 3000}`;
  if (
    req.headers.origin !== expected ||
    req.headers["sec-fetch-site"] === "cross-site"
  )
    return res.status(403).json({ error: "INVALID_ORIGIN" });
  next();
}
module.exports = {
  validateAuth,
  authenticate,
  login: loginOwner,
  logout,
  sameOrigin,
};
