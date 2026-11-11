// Small runtime helpers shared by both prototypes. No network, no dependencies.
let LANG = 'vi';
export const setLang = (l) => { LANG = l; };
export const getLang = () => LANG;

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

const nf = new Map();
export function num(v, digits = 0) {
  if (v == null || !Number.isFinite(v)) return '—';
  const k = LANG + digits;
  if (!nf.has(k)) nf.set(k, new Intl.NumberFormat(LANG, { maximumFractionDigits: digits, minimumFractionDigits: digits > 0 && digits < 3 ? digits : 0 }));
  return nf.get(k).format(v);
}
export function compact(v) {
  if (v == null) return '—';
  return new Intl.NumberFormat(LANG, { notation: 'compact', maximumFractionDigits: 1 }).format(v);
}
export function pct(v, digits = 1) {
  if (v == null || !Number.isFinite(v)) return '—';
  return (v > 0 ? '+' : v < 0 ? '−' : '') + num(Math.abs(v), digits) + '%';
}
export function date(iso, opts = { day: '2-digit', month: 'short' }) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat(LANG, { ...opts, timeZone: 'UTC' }).format(new Date(iso.length === 10 ? iso + 'T12:00:00Z' : iso));
}
export const region = (code) => {
  try { return new Intl.DisplayNames([LANG], { type: 'region' }).of(code.toUpperCase()) || code; } catch { return code; }
};

// View Transitions when available; plain update otherwise or when motion is reduced.
export function vt(fn, cls) {
  if (!document.startViewTransition || reduced()) { fn(); return Promise.resolve(); }
  if (cls) document.documentElement.dataset.vt = cls;
  const v = document.startViewTransition(fn);
  return v.finished.catch(() => {}).finally(() => { delete document.documentElement.dataset.vt; });
}

// Count-up numbers between renders. Elements: data-tw (target), data-twk (stable key), data-twd (digits), data-twf ("pct" | "num")
const tweened = new Map();
export function tween(root) {
  root.querySelectorAll('[data-tw]').forEach((el) => {
    const key = el.dataset.twk, to = Number(el.dataset.tw), d = Number(el.dataset.twd || 0);
    const f = el.dataset.twf === 'pct' ? (v) => pct(v, d) : (v) => num(v, d);
    const prev = tweened.has(key) ? tweened.get(key) : to;
    const from = el._raf && Number.isFinite(el._cur) ? el._cur : prev;
    if (el._raf && el._to === to) { el.textContent = f(el._cur); return; }
    tweened.set(key, to);
    if (el._raf) { cancelAnimationFrame(el._raf); el._raf = 0; }
    if (!Number.isFinite(to) || from === to || reduced() || !Number.isFinite(from)) { el.textContent = Number.isFinite(to) ? f(to) : el.textContent; return; }
    const t0 = performance.now(), dur = 650;
    el._to = to;
    const step = (now) => {
      const p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 4);
      el._cur = from + (to - from) * e;
      el.textContent = f(el._cur);
      el._raf = p < 1 ? requestAnimationFrame(step) : 0;
    };
    el._cur = from;
    el.textContent = f(from);
    el._raf = requestAnimationFrame(step);
  });
}

// Mark first appearance only, so re-renders never replay entrance motion.
const seen = new Set();
export function enter(root) {
  root.querySelectorAll('[data-enter]').forEach((el, i) => {
    const k = el.dataset.enter;
    if (seen.has(k)) return;
    seen.add(k);
    el.style.setProperty('--i', el.dataset.i ?? i % 12);
    el.classList.add('is-entering');
    el.addEventListener('animationend', () => el.classList.remove('is-entering'), { once: true });
  });
}

// Minimal keyed DOM morph: keeps focus, input state, open <details>, running transitions and mounted charts.
const keyOf = (n) => (n.nodeType === 1 ? n.getAttribute('data-key') : null);
const same = (a, b) => a.nodeType === b.nodeType && a.nodeName === b.nodeName && keyOf(a) === keyOf(b);
export function morph(target, html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  patchChildren(target, tpl.content);
}
function patchChildren(parent, next) {
  const fresh = [...next.childNodes];
  const keyed = new Map();
  parent.childNodes.forEach((n) => { const k = keyOf(n); if (k) keyed.set(k, n); });
  fresh.forEach((nn, idx) => {
    const cur = parent.childNodes[idx] || null;
    const k = keyOf(nn);
    const match = k ? keyed.get(k) : cur && !keyOf(cur) && same(cur, nn) ? cur : null;
    if (match && same(match, nn)) {
      if (match !== cur) parent.insertBefore(match, cur);
      if (k) keyed.delete(k);
      patch(match, nn);
    } else parent.insertBefore(nn, cur);
  });
  while (parent.childNodes.length > fresh.length) parent.removeChild(parent.lastChild);
}
function patch(a, b) {
  if (a.nodeType === 3 || a.nodeType === 8) { if (a.nodeValue !== b.nodeValue) a.nodeValue = b.nodeValue; return; }
  if (a.nodeType !== 1) return;
  if (a.hasAttribute('data-static') && b.hasAttribute('data-static')) return;
  for (const { name } of [...a.attributes]) {
    if (name === 'open' && a.tagName === 'DETAILS') continue;
    if (!b.hasAttribute(name)) a.removeAttribute(name);
  }
  for (const { name, value } of [...b.attributes]) if (a.getAttribute(name) !== value) a.setAttribute(name, value);
  const tag = a.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') {
    if (b.hasAttribute('value') && a !== document.activeElement && a.value !== b.getAttribute('value')) a.value = b.getAttribute('value');
    if (a.type === 'checkbox' || a.type === 'radio') a.checked = b.hasAttribute('checked');
    if (tag === 'TEXTAREA' && b.hasAttribute('data-value') && a !== document.activeElement) a.value = b.getAttribute('data-value');
  }
  if (a.hasAttribute('data-chart')) return; // chart owns its children
  if (tag === 'TEXTAREA') return;
  patchChildren(a, b);
  if (tag === 'SELECT') {
    const v = b.querySelector('option[selected]')?.value;
    if (v != null && a.value !== v) a.value = v;
  }
}

export function download(name, text, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Toasts with optional undo. Region must exist: <div id="toasts" aria-live="polite"></div>
export function toast(text, { undo, tone = 'ok', undoLabel = 'Undo' } = {}) {
  const box = document.getElementById('toasts');
  if (!box) return;
  const el = document.createElement('div');
  el.className = 'toast ' + tone;
  el.setAttribute('role', 'status');
  el.innerHTML = `<span>${esc(text)}</span>`;
  if (undo) {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = undoLabel;
    b.onclick = () => { undo(); dismiss(); };
    el.append(b);
  }
  box.append(el);
  const dismiss = () => { el.classList.add('out'); setTimeout(() => el.remove(), reduced() ? 0 : 220); };
  setTimeout(dismiss, undo ? 6000 : 3600);
}

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
