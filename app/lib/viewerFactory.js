const { getBaseConfig, DATA_DIR } = require("./config");
const AppleAppStoreStatsViewer = require("./AppleAppStoreStatsViewer");
const GooglePlayStoreStatsViewer = require("./GooglePlayStoreStatsViewer");
const resolver = require("./resolver");
const { getNormalizedPairings } = require("./metrics");

const { limited } = require("./utils/concurrency");
const limitViewer = (viewer) => {
  const original = viewer.getAppStats.bind(viewer);
  viewer.getAppStats = (...args) => limited(() => original(...args));
  return viewer;
};

const buildAppleViewer = (baseConfig, appId) => {
  if (!baseConfig.applePrivateKey) throw new Error("APPLE_NOT_CONFIGURED");
  const privateKey = baseConfig.applePrivateKey;
  return limitViewer(
    new AppleAppStoreStatsViewer({
      issuerId: baseConfig.appleIssuerId,
      keyId: baseConfig.appleKeyId,
      vendorId: baseConfig.appleVendorId,
      privateKey,
      appId,
      dataDir: DATA_DIR,
    }),
  );
};

const buildGoogleViewer = (baseConfig, packageName) => {
  return limitViewer(
    new GooglePlayStoreStatsViewer({
      keyJson: baseConfig.keyJson,
      projectID: baseConfig.projectID,
      bucketName: baseConfig.bucketName,
      packageName,
      dataDir: DATA_DIR,
    }),
  );
};

const getIgnoredSet = (baseConfig) => {
  const list = [...(baseConfig?.ignoredPackages || [])];
  const normalizedPairs = getNormalizedPairings(baseConfig);
  normalizedPairs.forEach((pair) => {
    if (pair.ignore) {
      if (pair.googlePackageName) list.push(pair.googlePackageName);
      if (pair.appleBundleId) list.push(pair.appleBundleId);
      if (pair.name) list.push(pair.name);
    }
  });
  return new Set(
    list.map((p) => String(p).trim().toLowerCase()).filter(Boolean),
  );
};

const isIgnored = (pkg, ignoredSet) => {
  if (!pkg || !ignoredSet || ignoredSet.size === 0) return false;
  const candidates = [
    pkg.packageName,
    pkg.bundleId,
    pkg.appId,
    pkg.adamId,
    pkg.name,
  ];
  return candidates.some(
    (c) => c && ignoredSet.has(String(c).trim().toLowerCase()),
  );
};

const fetchPackagesByPlatform = async (platform, baseConfig) => {
  const allPkgs = await resolver.resolve(
    "packages:all",
    { platform },
    async () => {
      const fetchApple = async () => {
        try {
          const viewer = buildAppleViewer(baseConfig);
          const pkgs = await viewer.listPackages();
          return pkgs.map((p) => ({ ...p, platform: "apple" }));
        } catch (e) {
          console.error("Error fetching Apple packages:", e.message);
          return [];
        }
      };

      const fetchGoogle = async () => {
        try {
          const viewer = buildGoogleViewer(baseConfig, "dummy");
          const pkgs = await viewer.listPackages();
          return pkgs.map((p) => ({ ...p, platform: "google" }));
        } catch (e) {
          console.error("Error fetching Google packages:", e.message);
          return [];
        }
      };

      if (platform === "apple") return fetchApple();
      if (platform === "google") return fetchGoogle();
      const [applePkgs, googlePkgs] = await Promise.all([
        fetchApple(),
        fetchGoogle(),
      ]);
      return [...applePkgs, ...googlePkgs];
    },
  );

  const ignoredSet = getIgnoredSet(baseConfig);
  return (allPkgs || []).filter((p) => !isIgnored(p, ignoredSet));
};

module.exports = {
  buildAppleViewer,
  buildGoogleViewer,
  fetchPackagesByPlatform,
  getIgnoredSet,
  isIgnored,
};
