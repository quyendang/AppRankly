// In-app purchase and subscription counts from store sales reports.
// Apple and Google adapters produce plain events; this module turns them into daily and per-product totals.
const KINDS = ["iap", "subscription"];

// Apple Product Type Identifiers (a trailing -M marks the Mac variant).
// Free items (IAC free subscription, FI1 free in-app) are not purchases and are skipped.
const APPLE_KINDS = { IA1: "iap", IA9: "subscription", IAY: "subscription" };
function appleKind(type) {
  return APPLE_KINDS[String(type || "").trim().toUpperCase().replace(/-M$/, "")] || null;
}
// Google "Product Type" column: Subscription, One-time product, Paid app.
function googleKind(type) {
  const value = String(type || "").trim().toLowerCase();
  if (!value || value.includes("paid app")) return null;
  if (value.includes("subscription")) return "subscription";
  if (value.includes("one-time") || value.includes("in-app") || value.includes("product")) return "iap";
  return null;
}

const money = (value) => Math.round(value * 100) / 100;
const blank = () => ({ purchases: 0, refunds: 0, revenueByCurrency: {} });
function addMoney(target, currency, amount) {
  if (/^[A-Z]{3}$/.test(currency || "") && Number.isFinite(amount))
    target[currency] = (target[currency] || 0) + amount;
}
function roundAll(byCurrency) {
  return Object.fromEntries(Object.entries(byCurrency).map(([currency, value]) => [currency, money(value)]));
}

/**
 * events: [{ date: "YYYY-MM-DD", kind: "iap"|"subscription", sku, title, units, currency, amount }]
 * units is signed (negative = refund). amount is signed and already multiplied by units where the store reports per-unit prices.
 */
function summarizePurchases(events = []) {
  const daily = new Map(), products = new Map();
  const totals = { iap: blank(), subscription: blank() };
  for (const event of events) {
    if (!KINDS.includes(event.kind) || !/^\d{4}-\d{2}-\d{2}$/.test(event.date || "")) continue;
    const units = Number(event.units) || 0, bought = Math.max(units, 0), refunded = Math.max(-units, 0);
    const day = daily.get(event.date) || { date: event.date, iap: 0, subscription: 0, refunds: 0 };
    day[event.kind] += bought;
    day.refunds += refunded;
    daily.set(event.date, day);
    const sku = String(event.sku || event.title || "").trim().slice(0, 200);
    const key = event.kind + "|" + sku;
    const product = products.get(key) || { sku, title: "", kind: event.kind, ...blank() };
    if (!product.title && event.title) product.title = String(event.title).trim().slice(0, 200);
    product.purchases += bought;
    product.refunds += refunded;
    addMoney(product.revenueByCurrency, event.currency, event.amount);
    products.set(key, product);
    const total = totals[event.kind];
    total.purchases += bought;
    total.refunds += refunded;
    addMoney(total.revenueByCurrency, event.currency, event.amount);
  }
  for (const total of Object.values(totals)) total.revenueByCurrency = roundAll(total.revenueByCurrency);
  return {
    daily: [...daily.values()].sort((a, b) => a.date.localeCompare(b.date)),
    products: [...products.values()]
      .map((product) => ({ ...product, revenueByCurrency: roundAll(product.revenueByCurrency) }))
      .sort((a, b) => b.purchases - a.purchases || (a.title || a.sku).localeCompare(b.title || b.sku))
      .slice(0, 100),
    totals,
  };
}
module.exports = { appleKind, googleKind, summarizePurchases };
