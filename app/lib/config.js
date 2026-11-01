const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DATA_DIR } = require("./runtime");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");
const defaults = {
  name: "My apps",
  refreshIntervalHours: 1,
  statsCheckRangeDays: 30,
  activeStartHour: 0,
  activeEndHour: 23,
  timezone: "Asia/Ho_Chi_Minh",
  notificationsEnabled: false,
  ignoredPackages: [],
  googlePackages: [],
  appMetadata: {},
};
const allowed = new Set(Object.keys(defaults));
function getSettings() {
  if (!fs.existsSync(SETTINGS_FILE)) return { ...defaults };
  if (fs.lstatSync(SETTINGS_FILE).isSymbolicLink())
    throw new Error("UNSAFE_SETTINGS_FILE");
  const stored = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"));
  return {
    ...defaults,
    ...Object.fromEntries(
      Object.entries(stored).filter(([k]) => allowed.has(k)),
    ),
  };
}
function saveSettings(input) {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some((k) => !allowed.has(k))
  )
    throw new Error("INVALID_SETTINGS");
  const next = { ...getSettings(), ...input };
  for (const [k, min, max] of [
    ["refreshIntervalHours", 1, 24],
    ["statsCheckRangeDays", 1, 366],
    ["activeStartHour", 0, 23],
    ["activeEndHour", 0, 23],
  ])
    if (!Number.isInteger(next[k]) || next[k] < min || next[k] > max)
      throw new Error("INVALID_SETTINGS");
  if (
    typeof next.name !== "string" ||
    next.name.length > 100 ||
    typeof next.notificationsEnabled !== "boolean" ||
    typeof next.timezone !== "string"
  )
    throw new Error("INVALID_SETTINGS");
  new Intl.DateTimeFormat("en", { timeZone: next.timezone }).format();
  if (
    !Array.isArray(next.ignoredPackages) ||
    next.ignoredPackages.some(
      (x) => typeof x !== "string" || !/^[\w.-]{1,200}$/.test(x),
    )
  )
    throw new Error("INVALID_SETTINGS");
  if (
    !Array.isArray(next.googlePackages) ||
    next.googlePackages.length > 20 ||
    next.googlePackages.some(
      (id) =>
        typeof id !== "string" ||
        !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$/.test(id),
    )
  )
    throw new Error("INVALID_SETTINGS");
  if (
    !next.appMetadata ||
    typeof next.appMetadata !== "object" ||
    Array.isArray(next.appMetadata)
  )
    throw new Error("INVALID_SETTINGS");
  for (const [id, meta] of Object.entries(next.appMetadata))
    if (
      !/^[\w.-]{1,200}$/.test(id) ||
      !meta ||
      Object.keys(meta).some((k) => k !== "displayName") ||
      typeof meta.displayName !== "string" ||
      meta.displayName.length > 100
    )
      throw new Error("INVALID_SETTINGS");
  const tmp = SETTINGS_FILE + "." + crypto.randomUUID() + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(next), { mode: 0o600, flag: "wx" });
  fs.renameSync(tmp, SETTINGS_FILE);
  invalidateConfigCache();
  return next;
}
function googleCredentials() {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) return null;
  try {
    const k = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    if (
      k.type !== "service_account" ||
      !k.client_email ||
      !k.private_key ||
      !k.project_id ||
      crypto.createPrivateKey(k.private_key).asymmetricKeyType !== "rsa"
    )
      throw new Error();
    return {
      type: "service_account",
      project_id: k.project_id,
      private_key: k.private_key,
      private_key_id: k.private_key_id,
      client_email: k.client_email,
    };
  } catch {
    throw new Error("INVALID_GOOGLE_SERVICE_ACCOUNT_JSON");
  }
}
function getBaseConfig() {
  const s = getSettings(),
    keyJson = googleCredentials();
  return {
    ...s,
    keyJson,
    projectID: keyJson?.project_id,
    bucketName: process.env.GOOGLE_BUCKET_NAME || "",
    appleIssuerId: process.env.APPLE_ISSUER_ID,
    appleKeyId: process.env.APPLE_KEY_ID,
    appleVendorId: process.env.APPLE_VENDOR_ID,
    applePrivateKey: process.env.APPLE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    ntfyTopic: s.notificationsEnabled ? process.env.NTFY_TOPIC || "" : "",
    webhookUrl: s.notificationsEnabled
      ? process.env.DISCORD_WEBHOOK_URL || ""
      : "",
    slackWebhookUrl: s.notificationsEnabled
      ? process.env.SLACK_WEBHOOK_URL || ""
      : "",
    telegram: s.notificationsEnabled
      ? {
          botToken: process.env.TELEGRAM_BOT_TOKEN,
          chatId: process.env.TELEGRAM_CHAT_ID,
        }
      : {},
  };
}
function validateCredentials() {
  googleCredentials();
  const apple = [
    "APPLE_PRIVATE_KEY",
    "APPLE_ISSUER_ID",
    "APPLE_KEY_ID",
    "APPLE_VENDOR_ID",
  ];
  if (apple.some((k) => process.env[k]) && !apple.every((k) => process.env[k]))
    throw new Error("INCOMPLETE_APPLE_CREDENTIALS");
  if (process.env.APPLE_PRIVATE_KEY)
    try {
      if (
        crypto.createPrivateKey(
          process.env.APPLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
        ).asymmetricKeyType !== "ec"
      )
        throw new Error();
    } catch {
      throw new Error("INVALID_APPLE_PRIVATE_KEY");
    }
  if (
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON &&
    !/^[a-zA-Z0-9._-]{3,222}$/.test(process.env.GOOGLE_BUCKET_NAME || "")
  )
    throw new Error("INVALID_GOOGLE_BUCKET_NAME");
}
function invalidateConfigCache() {
  require("./resolver").clearCache();
}
module.exports = {
  DATA_DIR,
  getSettings,
  saveSettings,
  getBaseConfig,
  validateCredentials,
  invalidateConfigCache,
};
