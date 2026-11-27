const config = require("./config");
const viewers = require("./viewerFactory");
const store = require("./portfolio");

function integrations() {
  return {
    google: { configured: !!process.env.GOOGLE_SERVICE_ACCOUNT_JSON },
    apple: { configured: !!process.env.APPLE_PRIVATE_KEY },
    ai: require("./ai").getAIStatus(),
    notifications: { configured: !!(process.env.NTFY_TOPIC || process.env.DISCORD_WEBHOOK_URL ||
      process.env.SLACK_WEBHOOK_URL || (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID)) },
  };
}

async function testIntegration(platform) {
  if (!["google", "apple"].includes(platform)) throw new Error("NOT_FOUND");
  try {
    const base = config.getBaseConfig();
    const viewer = platform === "google" ? viewers.buildGoogleViewer(base, "dummy") : viewers.buildAppleViewer(base);
    await viewer.listPackages();
    return { success: true };
  } catch {
    throw new Error("CONNECTION_FAILED");
  }
}

function updateGooglePackage(packageName, remove = false) {
  if (!store.identifier(packageName) || !packageName.includes(".")) throw new Error("INVALID_PACKAGE");
  const current = config.getSettings().googlePackages || [];
  return config.saveSettings({
    googlePackages: remove ? current.filter(id => id !== packageName) : [...new Set([...current, packageName])],
  });
}
module.exports = { integrations, testIntegration, updateGooglePackage };
