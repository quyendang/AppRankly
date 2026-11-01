const { Storage } = require("@google-cloud/storage");
const csv = require("@fast-csv/parse");
const crypto = require("node:crypto");
const resolver = require("./resolver");
const limited = require("./utils/concurrency").createLimiter(2);
function reviewId(link) {
  try {
    const url = new URL(link);
    if (url.hostname !== "play.google.com") return null;
    const id = url.searchParams.get("reviewId") || url.hash.match(/(?:#|:)id=([^,&]+)/)?.[1];
    return id ? decodeURIComponent(id) : null;
  } catch { return null; }
}
async function parseReviewCsv(content, packageName) {
  const rows = [];
  await new Promise((resolve, reject) => csv.parseString(content.replace(/^\uFEFF/, ""), { headers: true })
    .on("data", row => {
      if (row["Package Name"] !== packageName || !row["Review Text"]) return;
      const id = reviewId(row["Review Link"]);
      const rawDate = row["Review Last Update Date and Time"] || row["Review Submit Date and Time"];
      const date = Number.isFinite(Date.parse(rawDate)) ? new Date(rawDate).toISOString() : null;
      rows.push({ id: id || "csv-" + crypto.createHash("sha256").update(JSON.stringify([packageName, row["Review Submit Date and Time"], row["Review Title"], row["Review Text"]])).digest("hex"),
        author: "", text: [row["Review Title"], row["Review Text"]].filter(Boolean).join("\n"), rating: Number(row["Star Rating"]) || null,
        language: row["Reviewer Language"] || "", date, replyText: row["Developer Reply Text"] || null,
        replyDate: row["Developer Reply Date and Time"] || null, source: "csv", canReply: !!id });
    }).on("error", reject).on("end", resolve));
  return rows;
}
async function getGoogleReviewHistory(config, packageName) {
  if (!config.keyJson || !config.bucketName) return [];
  const credentials = typeof config.keyJson === "string" ? JSON.parse(config.keyJson) : config.keyJson;
  const storage = new Storage({ credentials, scopes: "https://www.googleapis.com/auth/devstorage.read_only",
    retryOptions: { maxRetries: 1, totalTimeout: 20 } });
  const prefix = `reviews/reviews_${packageName}_`;
  const names = await resolver.resolve("google:review-csv-list", { bucket: config.bucketName, packageName }, async () => {
    const [files] = await storage.bucket(config.bucketName).getFiles({ prefix });
    return files.map(file => file.name).filter(name => name.startsWith(prefix) && /^\d{6}\.csv$/.test(name.slice(prefix.length))).sort().reverse().slice(0, 12);
  });
  const reports = await Promise.all(names.map(name => limited(async () => {
    try {
      return await resolver.resolve("google:review-csv", { bucket: config.bucketName, name }, async () => {
        const chunks = []; let size = 0;
        const stream = storage.bucket(config.bucketName).file(name).createReadStream();
        for await (const chunk of stream) {
          size += chunk.length;
          if (size > 20 * 1024 * 1024) { stream.destroy(); throw new Error("REPORT_TOO_LARGE"); }
          chunks.push(chunk);
        }
        const buffer = Buffer.concat(chunks);
        return parseReviewCsv(buffer.toString(buffer[0] === 255 && buffer[1] === 254 ? "utf16le" : "utf8"), packageName);
      });
    } catch { return []; }
  })));
  return reports.flat();
}
module.exports = { getGoogleReviewHistory, parseReviewCsv };
