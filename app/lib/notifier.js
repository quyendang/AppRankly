const fs = require("node:fs");
const path = require("node:path");
const axios = require("axios");
const { DATA_DIR, redact } = require("./runtime");
const { getSettings } = require("./config");
const { cleanData } = require("./notificationData");
const file = path.join(DATA_DIR, "notifications.json");
function load() {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return { items: [] };
  }
}
function save(store) {
  fs.writeFileSync(file + ".tmp", JSON.stringify(store), { mode: 0o600 });
  fs.renameSync(file + ".tmp", file);
}
function addNotificationRecord(dataDir, item) {
  const store = load();
  store.items.unshift({
    title: redact(item.title),
    message: redact(item.message),
    priority: item.priority || "normal",
    source: "system",
    ...(item.data ? { data: cleanData(item.data) } : {}),
    id: require("node:crypto").randomUUID(),
    timestamp: new Date().toISOString(),
    read: false,
  });
  store.items = store.items.slice(0, 100);
  save(store);
}
async function post(url, data, headers = {}) {
  try {
    await axios.post(url, data, { headers, timeout: 8000, maxRedirects: 0 });
    return { success: true };
  } catch {
    return { success: false, error: "NOTIFICATION_FAILED" };
  }
}
async function sendNtfyNotification({ title, message, topic }) {
  if (!getSettings().notificationsEnabled) return { skipped: true };
  const target = process.env.NTFY_TOPIC;
  if (!target) return { skipped: true };
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(target))
    return { success: false, error: "INVALID_NOTIFICATION_TARGET" };
  return post("https://ntfy.sh/" + target, redact(message), {
    Title: redact(title),
  });
}
async function sendWebhookNotification({ title, message, webhookUrl }) {
  if (!getSettings().notificationsEnabled) return { skipped: true };
  const target =
    webhookUrl ||
    process.env.DISCORD_WEBHOOK_URL ||
    process.env.SLACK_WEBHOOK_URL;
  if (!target) return { skipped: true };
  try {
    const u = new URL(target);
    if (
      u.protocol !== "https:" ||
      u.username ||
      u.password ||
      u.port ||
      !["hooks.slack.com", "discord.com"].includes(u.hostname) ||
      !/^\/(services|api\/webhooks)\//.test(u.pathname)
    )
      throw new Error();
  } catch {
    return { success: false, error: "INVALID_NOTIFICATION_TARGET" };
  }
  return post(target, {
    text: redact(title + "\n" + message),
    content: redact(title + "\n" + message),
  });
}
async function sendTelegramNotification({ title, message }) {
  if (!getSettings().notificationsEnabled) return { skipped: true };
  const token = process.env.TELEGRAM_BOT_TOKEN,
    chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) return { skipped: true };
  if (!/^\d+:[\w-]+$/.test(token))
    return { success: false, error: "INVALID_NOTIFICATION_TARGET" };
  return post("https://api.telegram.org/bot" + token + "/sendMessage", {
    chat_id: chat,
    text: redact(title + "\n" + message),
  });
}
async function broadcastAlert(options) {
  addNotificationRecord(DATA_DIR, options);
  const ntfyResult = await sendNtfyNotification(options),
    webhookResult = await sendWebhookNotification(options),
    telegramResult = await sendTelegramNotification(options);
  let slackResult = { skipped: true };
  if (options.slackWebhookUrl && options.slackWebhookUrl !== options.webhookUrl)
    slackResult = await sendWebhookNotification({
      ...options,
      webhookUrl: options.slackWebhookUrl,
    });
  return { ntfyResult, webhookResult, telegramResult, slackResult };
}
async function syncNtfyTopicMessages() {
  const store = load();
  return {
    notifications: store.items,
    unreadCount: store.items.filter((x) => !x.read).length,
  };
}
function clearNotifications(dataDir, id) {
  const store = load();
  store.items = id ? store.items.filter((x) => x.id !== id) : [];
  save(store);
  return { success: true };
}
function markNotificationsRead(dataDir, id) {
  const store = load();
  store.items = store.items.map((x) =>
    !id || x.id === id ? { ...x, read: true } : x,
  );
  save(store);
  return { success: true };
}
module.exports = {
  sendNtfyNotification,
  sendWebhookNotification,
  sendTelegramNotification,
  broadcastAlert,
  addNotificationRecord,
  syncNtfyTopicMessages,
  clearNotifications,
  markNotificationsRead,
};
