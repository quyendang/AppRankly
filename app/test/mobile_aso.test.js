const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { randomBytes } = require("node:crypto");
const bcrypt = require("bcryptjs");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apprankly-mobile-aso-"));
process.env.DATA_DIR = dir;
process.env.DB_PATH = path.join(dir, "fixture.sqlite");
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = randomBytes(32).toString("hex");
const password = "test-only-mobile-aso";
process.env.ADMIN_PASSWORD_HASH = bcrypt.hashSync(password, 4);
const fixture = require("./mobile_aso_fixture").install();
const { createApp } = require("../server");

(async () => {
  const server = createApp().listen(0, "127.0.0.1");
  try {
    await new Promise((resolve, reject) => server.once("listening", resolve).once("error", reject));
    const origin = "http://127.0.0.1:" + server.address().port;
    process.env.APP_ORIGIN = origin;
    const api = async (route, { token, method, body } = {}) => {
      const response = await fetch(origin + "/api/v1" + route, {
        method: method || (body === undefined ? "GET" : "POST"),
        headers: { ...(token ? { Authorization: "Bearer " + token } : {}),
          ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: response.status, ...(await response.json()) };
    };
    const { accessToken: token } = await api("/auth/login", { body: { password } });
    const call = (route, body, method) => api(route, { token, body, method });
    const scoped = app => "/apps/" + encodeURIComponent(app.id);
    const apple = scoped(fixture.apple), google = scoped(fixture.google);
    const inVN = apple + "/keywords?country=vn";
    for (const suffix of ["/keywords", "/listing", "/competitors", "/campaigns", "/rank-checks/unowned"])
      assert.equal((await api(apple + suffix)).status, 401);
    assert.equal((await call(apple + "/keywords?country=constructor")).status, 400);

    const first = await call(inVN);
    assert.deepEqual(first.market, { country: "vn", language: "vi" });
    const term = text => first.keywords.find(keyword => keyword.term === text);
    assert.equal(term("sổ chi tiêu").rank, 4);
    assert.equal(term("tài chính").status, "unchecked");
    const history = await call(apple + "/keywords/" + term("sổ chi tiêu").id + "/history?country=vn");
    assert.equal(history.points.length, 1);
    assert.equal(history.points[0].rank, 4);
    assert.equal((await call(google + "/keywords/" + term("sổ chi tiêu").id + "/history")).status, 404);
    assert.equal((await call(google + "/keywords/" + term("sổ chi tiêu").id, undefined, "DELETE")).status, 404);
    assert.ok((await call(apple + "/keywords?country=us")).keywords.every(keyword => keyword.status === "unchecked"));

    async function wait(jobId) {
      for (let i = 0; i < 30; i++) {
        const job = await call(apple + "/rank-checks/" + jobId);
        if (job.state !== "running") return job;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      throw new Error("rank check did not finish");
    }
    const [job1, job2] = await Promise.all(Array.from({ length: 2 }, () => call(apple + "/rank-checks", { country: "vn" })));
    assert.equal(job1.status, 202);
    assert.equal(job1.id, job2.id);
    assert.equal((await call(google + "/rank-checks/" + job1.id)).status, 404);
    const finished = await wait(job1.id);
    assert.equal(finished.state, "completed");
    assert.equal(finished.checked, 3);
    assert.equal(finished.failed, 1);
    assert.ok(fixture.searches.every(search => search.country === "vn" && search.strict === true));
    const updated = (await call(inVN)).keywords;
    assert.equal(updated.find(row => row.term === "app chậm").status, "source_failed");
    assert.equal(updated.find(row => row.term === "app chậm").rank, 8);
    assert.equal(updated.find(row => row.term === "tài chính").status, "outside");
    assert.equal(updated.find(row => row.term === "không kết quả").status, "no_results");
    fixture.failures.clear();
    const retried = await wait((await call(apple + "/rank-checks", { country: "vn" })).id);
    assert.equal(retried.failed, 0);
    assert.equal((await call(inVN)).keywords.find(row => row.term === "app chậm").status, "ranked");

    const listing = await call(apple + "/listing");
    assert.equal(listing.subtitle, "Theo dõi chi tiêu theo tháng");
    assert.equal(listing.storeUrl, "https://apps.apple.com/app/id12345");
    const found = await call(apple + "/competitors?q=v%C3%AD&country=vn");
    assert.deepEqual(found.competitors.map(row => row.id), [fixture.competitor.bundleId], "dedupe and remove self");
    assert.equal((await call(apple + "/competitors", { competitorId: fixture.competitor.bundleId })).status, 201);
    assert.equal((await call(apple + "/competitors")).competitors[0].pinned, true);
    await call(google + "/competitors/" + fixture.competitor.bundleId, undefined, "DELETE");
    assert.equal((await call(apple + "/competitors")).competitors.length, 1);

    const campaign = await call(apple + "/campaigns", { name: "Bản tin thử", source: "newsletter" });
    assert.equal(campaign.status, 201);
    assert.equal((await call(google + "/campaigns/" + campaign.id, undefined, "DELETE")).status, 404);
    const redirect = await fetch(origin + campaign.path, { redirect: "manual", headers: { "User-Agent": "Android" } });
    assert.equal(redirect.status, 302);
    assert.match(redirect.headers.get("location"), /^https:\/\/apps\.apple\.com\//);
    assert.equal((await call(apple + "/campaigns")).campaigns[0].clicks, 1);
    assert.equal((await call(apple + "/campaigns/" + campaign.id, undefined, "DELETE")).status, 200);

    const preview = await call("/ai/previews", { kind: "keywords", appId: fixture.apple.id, country: "vn", count: 10 });
    assert.equal(preview.payload.market.language, "vi");
    assert.deepEqual(preview.payload.competitors, ["Ví khác"]);
    assert.equal(fixture.runs(), 0);
    const confirmed = { previewId: preview.previewId, confirmed: true };
    const secondSession = await api("/auth/login", { body: { password } });
    assert.equal((await api("/ai/runs", { token: secondSession.accessToken, body: confirmed })).status, 400);
    assert.equal((await call("/ai/runs", { ...confirmed, confirmed: false })).status, 400);
    assert.equal((await call(apple + "/keywords", { term: "quản lý hóa đơn" })).status, 201);
    const suggestions = await call("/ai/runs", confirmed);
    assert.deepEqual(suggestions.suggestions, [
      { term: "ghi chép tiền", reason: "ghi nhanh các khoản chi" },
      { term: "theo dõi thu nhập", reason: "theo dõi các khoản thu" },
    ]);
    assert.equal((await call("/ai/runs", confirmed)).status, 400);
    assert.equal(fixture.runs(), 1);
    assert.ok(!(await call(inVN)).keywords.some(row => row.term === "ghi chép tiền" || row.term === "theo dõi thu nhập"));
    assert.equal((await call(apple + "/keywords", { terms: ["ghi chép tiền"] })).added, 1);
    const stored = (await call(inVN)).keywords;
    assert.ok(stored.some(row => row.term === "ghi chép tiền" && row.source === "ai"));
    assert.ok(!stored.some(row => row.term === "theo dõi thu nhập"));
    await call(apple + "/keywords/" + term("sổ chi tiêu").id, undefined, "DELETE");
    assert.equal((await call(apple + "/keywords/" + term("sổ chi tiêu").id + "/history")).status, 404);
    const additional = Array.from({ length: 22 }, (_, index) => "keyword " + index);
    assert.equal((await call(apple + "/keywords", { terms: additional })).added, 22);
    assert.equal((await wait((await call(apple + "/rank-checks", { country: "vn" })).id)).checked, 20);
    assert.equal((await wait((await call(apple + "/rank-checks", { country: "vn" })).id)).checked, 20);
    assert.ok((await call(inVN)).keywords.every(row => row.status !== "unchecked"),
      "repeated batches do not starve later keywords");
    console.log("PASS mobile ASO market isolation, partial rank checks, history, competitor/campaign scopes and keyword AI consent");
  } finally {
    server.close();
    fixture.db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch(error => {
  process.stderr.write(String(error.stack || error) + "\n");
  process.exitCode = 1;
});
