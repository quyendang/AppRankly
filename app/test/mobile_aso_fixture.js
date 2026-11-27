const analytics = require("./mobile_analytics_fixture");

function install() {
  analytics.install();
  const apple = analytics.apple;
  apple.appId = "12345";
  apple.storeUrl = "https://apps.apple.com/app/id12345";
  const google = analytics.google;
  const scraper = require("../lib/aso/scraper");
  const keywords = require("../lib/aso/keywords");
  const { db } = require("../lib/db");
  const competitor = { bundleId: "example.other", id: 77889, title: "Ví khác", score: 4.3 };
  const ownListing = { bundleId: apple.packageName, id: Number(apple.appId), title: apple.name, developer: "Fixture Studio",
    subtitle: "Theo dõi chi tiêu theo tháng", description: "Một phần mô tả công khai dùng cho kiểm thử.", url: apple.storeUrl, score: 4.7 };
  const failures = new Set(["app chậm"]);
  const searches = [];
  scraper.getAppleLookup = async id => [competitor.bundleId, String(competitor.id)].includes(String(id))
    ? competitor
    : [apple.packageName, apple.appId].includes(String(id)) ? ownListing : null;
  scraper.getPlayListing = async id => id === google.packageName ? { appId: id, title: google.name } : null;
  scraper.getAppleSearch = async (term, country, limit, options) => {
    searches.push({ term, country, limit, strict: options?.strict });
    await new Promise(resolve => setTimeout(resolve, 15));
    if (failures.has(term)) throw new Error("RANK_SOURCE_FAILED");
    if (term === "không kết quả") return [];
    if (term === "tài chính") return [competitor];
    if (term === "ví" && limit === 10) return [ownListing, competitor, competitor];
    return country === "vn" ? [competitor, ownListing] : [ownListing, competitor];
  };
  scraper.getPlaySearch = async () => [];
  keywords.track(apple, ["sổ chi tiêu", "app chậm", "tài chính", "không kết quả"]);
  keywords.track(google, ["tập trung"]);
  const record = db.prepare(`INSERT INTO aso_rank_history(package_name,platform,keyword_id,store,country,rank,top_n,checked_at,language)
    VALUES(?,'apple',?,'apple','vn',?,20,?,'vi')`);
  for (const item of keywords.terms(apple)) {
    if (item.term === "sổ chi tiêu" || item.term === "app chậm") {
      const date = Date.now() - 86400000;
      record.run(apple.packageName, item.id, 3, new Date(date - 1000).toISOString());
      record.run(apple.packageName, item.id, item.term === "app chậm" ? 8 : 4, new Date(date).toISOString());
    }
  }

  const ai = require("../lib/ai");
  ai.getAIStatus = () => ({ defaultProvider: "stub", providers: [
    { id: "stub", endpointOrigin: "https://ai.example.invalid", model: "mock" },
  ] });
  let runs = 0;
  ai.generateJSON = async ({ prompt }) => {
    runs++;
    if (JSON.parse(prompt).kind !== "keywords") throw new Error("INVALID_FIXTURE");
    return { provider: "stub", model: "mock", data: {
      candidates: ["sổ chi tiêu", "1. ghi chép tiền", "GHI CHÉP TIỀN", "quản lý hóa đơn", "theo dõi thu nhập"],
      recommendations: ["trùng", "ghi nhanh các khoản chi", "lặp", "có thể nhập tay", "theo dõi các khoản thu"],
    } };
  };
  return { db, apple, google, competitor, searches, failures, runs: () => runs };
}
module.exports = { install };
