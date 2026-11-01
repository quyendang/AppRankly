const fs = require("fs");
const path = require("path");

const InputParamsModel = require("./InputParamsModel");
const Dimensions = require("./Dimensions");
const resolver = require("./resolver");
const { PackageUtils } = require("./PackageUtils");


class GooglePlayStoreStatsViewer {
  constructor({ keyJson, packageName, projectID, bucketName, dataDir }) {
    this.inputParamsModel = new InputParamsModel({
      packageName,
      projectID,
      bucketName
    });
    this.keyJson = keyJson;
    this.packageUtils = new PackageUtils();
    this.Dimensions = Dimensions;
    this.dataDir = dataDir || path.join(process.cwd(), "data");
  }

  setPackageName(packageName) {
    this.inputParamsModel.packageName = packageName;
  }

  async initializeStorage() {
    let credentials;
    if (this.keyJson) {
      credentials = typeof this.keyJson === "string" ? JSON.parse(this.keyJson.replace(/^\uFEFF/, "").trim()) : this.keyJson;
    } else {
      throw new Error("GOOGLE_NOT_CONFIGURED");
    }

    if (credentials && credentials.quota_project_id) {
      delete credentials.quota_project_id;
    }

    await this.packageUtils.createAuthenticatedStorageObject({
      credentials,
      projectID: this.inputParamsModel.projectID
    });
  }

  async getAppStats(startDate, endDate, force = false) {
    const isForce = typeof force === 'object' ? Boolean(force.force || force.forceRefresh) : Boolean(force);
    if (isForce) {
      resolver.clearCache('gcs:filelist');
      resolver.clearCache('agg_cache');
    }
    await this.initializeStorage();

    const [files] = await this.packageUtils.getCorrectFiles({
      storage: this.packageUtils.authenticatedStorageObj,
      bucketName: this.inputParamsModel.bucketName,
      packageName: this.inputParamsModel.packageName
    });

    const [ratingFiles] = await this.packageUtils.getCorrectFiles({
      storage: this.packageUtils.authenticatedStorageObj,
      bucketName: this.inputParamsModel.bucketName,
      packageName: this.inputParamsModel.packageName,
      type: 'ratings'
    });

    const [vitalsCrashesFiles] = await this.packageUtils.getCorrectFiles({
      storage: this.packageUtils.authenticatedStorageObj,
      bucketName: this.inputParamsModel.bucketName,
      packageName: this.inputParamsModel.packageName,
      type: 'vitals_crashes'
    });

    const [vitalsAnrsFiles] = await this.packageUtils.getCorrectFiles({
      storage: this.packageUtils.authenticatedStorageObj,
      bucketName: this.inputParamsModel.bucketName,
      packageName: this.inputParamsModel.packageName,
      type: 'vitals_anrs'
    });

    const downloadDir = path.join(this.dataDir, 'download_stats', this.inputParamsModel.packageName);
    if (!fs.existsSync(downloadDir)) {
      fs.mkdirSync(downloadDir, { recursive: true });
    }

    const cleanedFileNames = await this.packageUtils.downloadCsvFiles({
      storage: this.packageUtils.authenticatedStorageObj,
      bucketName: this.inputParamsModel.bucketName,
      packageName: this.inputParamsModel.packageName,
      files,
      dimension: 'overview',
      targetLocation: downloadDir,
      startDate,
      endDate,
      force: isForce
    });

    const cleanedRatingFiles = await this.packageUtils.downloadCsvFiles({
      storage: this.packageUtils.authenticatedStorageObj,
      bucketName: this.inputParamsModel.bucketName,
      packageName: this.inputParamsModel.packageName,
      files: ratingFiles,
      dimension: 'overview',
      type: 'ratings',
      targetLocation: downloadDir,
      startDate,
      endDate,
      force: isForce
    });

    const cleanedCrashFiles = await this.packageUtils.downloadCsvFiles({
      storage: this.packageUtils.authenticatedStorageObj,
      bucketName: this.inputParamsModel.bucketName,
      packageName: this.inputParamsModel.packageName,
      files: vitalsCrashesFiles,
      dimension: 'overview',
      type: 'vitals_crashes',
      targetLocation: downloadDir,
      startDate,
      endDate,
      force: isForce
    });

    const cleanedAnrFiles = await this.packageUtils.downloadCsvFiles({
      storage: this.packageUtils.authenticatedStorageObj,
      bucketName: this.inputParamsModel.bucketName,
      packageName: this.inputParamsModel.packageName,
      files: vitalsAnrsFiles,
      dimension: 'overview',
      type: 'vitals_anrs',
      targetLocation: downloadDir,
      startDate,
      endDate,
      force: isForce
    });

    console.log(`Downloaded ${cleanedFileNames.length} overview, ${cleanedRatingFiles.length} ratings, and ${cleanedCrashFiles.length + cleanedAnrFiles.length} vitals`);

    if (cleanedFileNames.length === 0) {
      throw new Error(`No overview reports found for package: ${this.inputParamsModel.packageName}`);
    }

    return this.packageUtils.findSumTotalOfValues({
      cleanedFileNames: [
        ...cleanedFileNames,
        ...cleanedRatingFiles.map(f => f.startsWith('ratings') ? f : 'ratings_' + f),
        ...cleanedCrashFiles.map(f => f.startsWith('vitals') ? f : 'vitals_' + f),
        ...cleanedAnrFiles.map(f => f.startsWith('vitals') ? f : 'vitals_' + f)
      ],
      packageName: this.inputParamsModel.packageName,
      targetLocation: downloadDir,
      startDate,
      endDate
    });
  }

  async getDimensionStats(dimension, startDate, endDate) {
    await this.initializeStorage();

    const [files] = await this.packageUtils.getCorrectFiles({
      storage: this.packageUtils.authenticatedStorageObj,
      bucketName: this.inputParamsModel.bucketName,
      packageName: this.inputParamsModel.packageName
    });

    const downloadDir = path.join(this.dataDir, 'download_stats', this.inputParamsModel.packageName);
    if (!fs.existsSync(downloadDir)) {
      fs.mkdirSync(downloadDir, { recursive: true });
    }

    const downloaded = await this.packageUtils.downloadCsvFiles({
      storage: this.packageUtils.authenticatedStorageObj,
      bucketName: this.inputParamsModel.bucketName,
      packageName: this.inputParamsModel.packageName,
      files,
      dimension,
      targetLocation: downloadDir,
      startDate,
      endDate
    });

    if (downloaded.length === 0) {
      throw new Error(`No CSV report found for dimension: ${dimension}`);
    }

    const results = await Promise.all(downloaded.map(fileName => {
      const localFilePath = path.join(downloadDir, fileName);
      return this.packageUtils.parseDimensionFile(localFilePath, dimension, startDate, endDate);
    }));

    // Merge results from multiple files
    const mergedMap = new Map();
    results.flat().forEach(item => {
      if (!mergedMap.has(item.label)) {
        mergedMap.set(item.label, { ...item });
      } else {
        const existing = mergedMap.get(item.label);
        existing.activeDevices = Math.max(existing.activeDevices, item.activeDevices);
        existing.totalInstalls = Math.max(existing.totalInstalls, item.totalInstalls);
        existing.dailyUserInstalls += item.dailyUserInstalls;
        existing.dailyUserUninstalls += item.dailyUserUninstalls;
        existing.dailyDeviceInstalls += item.dailyDeviceInstalls;
        existing.dailyDeviceUninstalls += item.dailyDeviceUninstalls;
        existing.dailyDeviceUpgrades += item.dailyDeviceUpgrades;
        existing.installEvents += item.installEvents;
        existing.updateEvents += item.updateEvents;
        existing.uninstallEvents += item.uninstallEvents;
      }
    });

    const finalResults = Array.from(mergedMap.values()).map(item => {
      const netUserGrowth = item.dailyUserInstalls - item.dailyUserUninstalls;
      const retentionRate = item.totalInstalls > 0 ? (item.activeDevices / item.totalInstalls) * 100 : 0;
      return { ...item, netUserGrowth, retentionRate: parseFloat(retentionRate.toFixed(2)) };
    });

    return finalResults.sort((a, b) => b.activeDevices - a.activeDevices).slice(0, 20);
  }

  async listPackages() {
    try {
      await this.initializeStorage();
      const bucketName = this.inputParamsModel.bucketName;
      const fileNames = await resolver.resolve('packages', { platform: 'google', bucketName }, async () => {
        const [files] = await this.packageUtils.authenticatedStorageObj
          .bucket(bucketName)
          .getFiles({ prefix: "stats/installs/installs_" });
        return files.map(f => f.name);
      });

      const packages = new Set();
      const packageRegex = /^stats\/installs\/installs_(.+)_(\d{6})_(.+)\.csv$/;

      (fileNames || []).forEach(fileName => {
        const match = fileName.match(packageRegex);
        if (match) {
          packages.add(match[1]);
        }
      });

      return Array.from(packages).map(pkg => ({
        name: pkg.split(".").pop().split(/[_-]/).map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(" "),
        packageName: pkg
      }));
    } catch (e) {
      console.error("Error listing packages:", e);
      throw e;
    }
  }
}

module.exports = GooglePlayStoreStatsViewer;
