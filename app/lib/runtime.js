const fs = require("node:fs");
const path = require("node:path");
if (
  process.env.NODE_ENV === "production" &&
  process.env.DATA_DIR &&
  !path.isAbsolute(process.env.DATA_DIR)
) {
  throw new Error(
    "DATA_DIR_MUST_BE_ABSOLUTE: set DATA_DIR=/app/data on Railway",
  );
}
const DATA_DIR = path.resolve(
  process.env.DATA_DIR || path.join(__dirname, "..", "data"),
);
fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
if (fs.lstatSync(DATA_DIR).isSymbolicLink())
  throw new Error("UNSAFE_DATA_DIRECTORY");
const secrets = Object.entries(process.env)
  .filter(
    ([k, v]) =>
      /KEY|SECRET|TOKEN|PASSWORD|WEBHOOK|TOPIC/.test(k) && v.length >= 8,
  )
  .map(([, v]) => v);
try {
  const google = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || "{}");
  if (google.private_key) secrets.push(google.private_key);
} catch {}
function redact(value) {
  if (typeof value !== "string") return value;
  let result = value.replace(
    /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g,
    "[REDACTED]",
  );
  for (const secret of secrets)
    result = result.split(secret).join("[REDACTED]");
  return result;
}
function protectLogs() {
  for (const level of ["log", "warn", "error"]) {
    const original = console[level].bind(console);
    console[level] = (...values) =>
      original(
        ...values.map((v) =>
          v instanceof Error
            ? "OPERATION_FAILED"
            : redact(typeof v === "object" ? JSON.stringify(v) : v),
        ),
      );
  }
}
module.exports = { DATA_DIR, redact, protectLogs };
