const { db } = require("./db");
const store = require("./portfolio");

function hiddenApps() {
  return db.prepare("SELECT id, name FROM mobile_hidden_app ORDER BY name COLLATE NOCASE, id").all().map(app => {
    const [platform, packageName] = app.id.split(":");
    return { ...app, platform, packageName };
  });
}

async function listApps() {
  const catalog = await store.listApps();
  const hidden = new Set(hiddenApps().map(app => app.id));
  return { ...catalog, apps: catalog.apps.filter(app => !hidden.has(app.id)) };
}

function isHidden(id) {
  return !!db.prepare("SELECT 1 FROM mobile_hidden_app WHERE id=?").get(id);
}

function assertVisible(id) {
  if (typeof id !== "string" || isHidden(id)) throw new Error("APP_NOT_FOUND");
}

async function ownedApp(id) {
  assertVisible(id);
  const app = await store.ownedApp(id);
  assertVisible(app.id);
  return app;
}

async function setHidden(id, hidden) {
  const [platform, name, extra] = typeof id === "string" ? id.split(":") : [];
  if (!["apple", "google"].includes(platform) || !store.identifier(name) || extra !== undefined)
    throw new Error("APP_NOT_FOUND");
  if (hidden === false) {
    db.prepare("DELETE FROM mobile_hidden_app WHERE id=?").run(id);
    return;
  }
  if (hidden !== true) throw new Error("INVALID_INPUT");
  if (isHidden(id)) return;
  const app = await store.ownedApp(id);
  db.prepare("INSERT OR IGNORE INTO mobile_hidden_app(id, name) VALUES(?, ?)").run(app.id, app.name);
}

function visibleNotifications(feed) {
  const hidden = hiddenApps();
  if (!hidden.length) return feed;
  const notifications = feed.notifications.filter(item => {
    const subjects = [...(item.data?.items || []), ...(item.data?.hints || [])];
    const text = [item.title, item.message].join("\n");
    return !hidden.some(app => subjects.some(subject =>
      subject.appId === app.id || (!subject.appId && subject.platform === app.platform && subject.name === app.name)
    ) || (!subjects.length && (text.includes(app.packageName) || text.includes(app.name))));
  });
  return { notifications, unreadCount: notifications.filter(item => !item.read).length };
}

module.exports = { listApps, ownedApp, hiddenApps, setHidden, assertVisible, visibleNotifications };
