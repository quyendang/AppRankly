const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const config = require("../lib/config");
(async () => {
  const rsa = crypto
    .generateKeyPairSync("rsa", { modulusLength: 2048 })
    .privateKey.export({ type: "pkcs8", format: "pem" });
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify({
    type: "service_account",
    project_id: "synthetic-project",
    client_email: "test@synthetic-project.iam.gserviceaccount.com",
    private_key: rsa,
    token_uri: "https://attacker.invalid/token",
    universe_domain: "attacker.invalid",
    credential_source: { url: "https://attacker.invalid/key" },
  });
  process.env.GOOGLE_BUCKET_NAME = "synthetic-bucket";
  config.validateCredentials();
  const cfg = config.getBaseConfig();
  assert.equal(cfg.keyJson.token_uri, undefined);
  assert.equal(cfg.keyJson.universe_domain, undefined);
  assert.equal(cfg.keyJson.credential_source, undefined);
  const google = require("../lib/viewerFactory").buildGoogleViewer(
    cfg,
    "example.app",
  );
  await google.initializeStorage();
  assert.ok(google.packageUtils.authenticatedStorageObj);
  const key = crypto
    .generateKeyPairSync("ec", { namedCurve: "P-256" })
    .privateKey.export({ type: "pkcs8", format: "pem" });
  process.env.APPLE_PRIVATE_KEY = key.replace(/\n/g, "\\n");
  process.env.APPLE_ISSUER_ID = "synthetic-issuer";
  process.env.APPLE_KEY_ID = "synthetic-key-id";
  process.env.APPLE_VENDOR_ID = "synthetic-vendor";
  config.validateCredentials();
  assert.equal(config.getBaseConfig().applePrivateKey, key);
  const token = require("../lib/viewerFactory")
    .buildAppleViewer(config.getBaseConfig(), "example.app")
    .generateToken();
  assert.equal(require("jsonwebtoken").decode(token).iss, "synthetic-issuer");
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify({
    type: "external_account",
    credential_source: { url: "https://attacker.invalid/key" },
  });
  assert.throws(() => config.validateCredentials(), /INVALID_GOOGLE/);
  const { redact } = require("../lib/runtime");
  assert.ok(!redact(key).includes("BEGIN PRIVATE KEY"));
  assert.ok(!JSON.stringify(config.getSettings()).includes("PRIVATE KEY"));
  require("../lib/db").db.close();
  console.log(
    "PASS: in-memory SDK keys, escaped PEM, rejection of alternate credential endpoints and secret-free settings. No network calls.",
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
