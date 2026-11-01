const assert = require("node:assert/strict");
const { Readable } = require("node:stream");
const { crc32 } = require("node:zlib");
function zipCsv(content) {
  const body = Buffer.from(content), name = Buffer.from("sales.csv"), crc = crc32(body);
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4);
  local.writeUInt32LE(crc, 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(body.length, 22); local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
  central.writeUInt32LE(crc, 16); central.writeUInt32LE(body.length, 20); central.writeUInt32LE(body.length, 24); central.writeUInt16LE(name.length, 28);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + name.length, 12); end.writeUInt32LE(local.length + name.length + body.length, 16);
  return Buffer.concat([local, name, body, central, name, end]);
}
const header = "Package ID,Order Charged Date,Financial Status,Currency of Sale,Charged Amount\n";
const report = header + 'com.example.app,2026-10-20,Charged,USD,"1,234.50"\ncom.example.app,2026-10-20,Refund,USD,10\ncom.example.app,2026-10-20,Partial refund,USD,-5\ncom.example.app,2026-10-20,Charged,EUR,0.49\ncom.other.app,2026-10-20,Charged,USD,999\ncom.example.app,2026-10-19,Charged,USD,888\ncom.example.app,2026-10-20,Pending,USD,777\n';
const storage = require("@google-cloud/storage");
let failed = false;
const FakeStorage = class {
  bucket() { return { file: () => ({ createReadStream: () => failed ? Readable.from((async function*() { throw new Error("Synthetic denied"); })()) : Readable.from([zipCsv(report)]) }) }; }
};
require.cache[require.resolve("@google-cloud/storage")].exports = { ...storage, Storage: FakeStorage };
const { parseSales, unzipCsv, getGoogleSales } = require("../lib/googleSales");
(async () => {
  assert.deepEqual(await unzipCsv(zipCsv(report)), [report]);
  await assert.rejects(unzipCsv(Buffer.from("not zip")));
  await assert.rejects(parseSales(["Unexpected,Schema\na,b\n"]), /INVALID_GOOGLE_SALES_REPORT/);
  const config = { keyJson: {}, bucketName: "synthetic-sales" };
  const result = await getGoogleSales(config, "com.example.app", { startDate: "2026-10-20", endDate: "2026-10-20" });
  assert.deepEqual(result.grossRevenueByCurrency, { USD: 1219.5, EUR: 0.49 });
  assert.equal(result.revenueStatus, "available");
  failed = true;
  require("../lib/resolver").clearCache("google:estimated-sales");
  assert.equal((await getGoogleSales(config, "com.example.app", { startDate: "2026-10-20", endDate: "2026-10-20" })).revenueAvailable, false);
  console.log("PASS: Google sales ZIP, schema checks, package/date matching, gross currencies, refunds and missing financial permissions.");
})().catch(error => { console.error(error); process.exitCode = 1; });
