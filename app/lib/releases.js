const fs = require("fs");
const path = require("path");
const { DATA_DIR } = require("./config");
const resolver = require("./resolver");

const RELEASES_FILE = path.join(DATA_DIR, "releases.json");

function getReleasesFromFile() {
  if (!fs.existsSync(RELEASES_FILE)) return [];
  if (fs.lstatSync(RELEASES_FILE).isSymbolicLink())
    throw new Error("UNSAFE_RELEASE_STORAGE");
  const records = JSON.parse(fs.readFileSync(RELEASES_FILE, "utf8"));
  if (!Array.isArray(records)) throw new Error("INVALID_RELEASE_STORAGE");
  return records.map((record, index) => ({
    ...record,
    id:
      record.id ||
      "legacy-" +
        require("node:crypto")
          .createHash("sha256")
          .update(JSON.stringify([index, record]))
          .digest("hex")
          .slice(0, 24),
  }));
}

function saveReleasesToFile(releases) {
  const temporary = RELEASES_FILE + ".tmp";
  fs.writeFileSync(temporary, JSON.stringify(releases, null, 2), {
    mode: 0o600,
  });
  fs.renameSync(temporary, RELEASES_FILE);
  resolver.clearCache("stats");
}

module.exports = {
  RELEASES_FILE,
  getReleasesFromFile,
  saveReleasesToFile,
};
