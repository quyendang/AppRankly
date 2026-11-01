const { GoogleAuth } = require("google-auth-library");

async function discoverGoogleApps(keyJson) {
  const credentials = typeof keyJson === "string"
    ? JSON.parse(keyJson.replace(/^\uFEFF/, "").trim()) : keyJson;
  const auth = new GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/playdeveloperreporting"],
  });
  const apps = new Map();
  const seen = new Set();
  let pageToken;
  do {
    const { data } = await auth.request({
      url: "https://playdeveloperreporting.googleapis.com/v1beta1/apps:search",
      params: { pageSize: 1000, ...(pageToken ? { pageToken } : {}) },
      timeout: 10000,
      retry: false,
    });
    for (const app of data.apps || []) {
      if (typeof app.packageName !== "string" ||
          !/^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/.test(app.packageName)) continue;
      apps.set(app.packageName, { packageName: app.packageName, name: app.displayName || app.packageName });
    }
    pageToken = data.nextPageToken;
    if (pageToken && seen.has(pageToken)) throw new Error("GOOGLE_DISCOVERY_PAGINATION_FAILED");
    seen.add(pageToken);
  } while (pageToken);
  return [...apps.values()];
}

module.exports = { discoverGoogleApps };
