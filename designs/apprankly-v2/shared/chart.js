// Dependency-free SVG line/area chart with hover scrubbing, event markers and animated updates.
// Mount: <div data-chart="id"></div>; call drawChart(el, spec) after every render.
import { num, date, esc, reduced } from './util.js';

const W = 720, PAD = { l: 44, r: 12, t: 14, b: 26 };
const state = new WeakMap();

function resample(pts, n) {
  if (pts.length === n) return pts;
  if (!pts.length) return Array(n).fill(null);
  return Array.from({ length: n }, (_, i) => pts[Math.round((i / Math.max(1, n - 1)) * (pts.length - 1))]);
}
function niceMax(v) {
  if (!(v > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v))), m = v / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
}
function pathOf(vals, x, y) {
  let d = '', pen = false;
  vals.forEach((v, i) => {
    if (v == null) { pen = false; return; }
    d += (pen ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1);
    pen = true;
  });
  return d;
}
function areaOf(vals, x, y, base) {
  const segs = []; let cur = [];
  vals.forEach((v, i) => { if (v == null) { if (cur.length) segs.push(cur); cur = []; } else cur.push(i); });
  if (cur.length) segs.push(cur);
  return segs.map((s) => 'M' + x(s[0]).toFixed(1) + ' ' + base + s.map((i) => 'L' + x(i).toFixed(1) + ' ' + y(vals[i]).toFixed(1)).join('') + 'L' + x(s.at(-1)).toFixed(1) + ' ' + base + 'Z').join('');
}

/**
 * spec: { dates: [iso], series: [{ key, label, color, values: [n|null], dashed?, area? }], height?, reverse?, max?, min?,
 *         events?: [{date,label,type}], format?: (v)=>string, label: string, empty?: string }
 */
export function drawChart(el, spec) {
  const H = spec.height || 240;
  const n = spec.dates.length;
  let st = state.get(el);
  if (!st) {
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img"></svg><div class="chart-tip" hidden></div>`;
    st = { prev: null, raf: 0 };
    state.set(el, st);
    bindHover(el, st);
  }
  const svg = el.querySelector('svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('aria-label', spec.label);
  el.style.setProperty('--chart-h', H + 'px');
  st.spec = spec; st.H = H;
  const all = spec.series.flatMap((s) => s.values).filter((v) => v != null);
  if (!all.length) {
    svg.innerHTML = `<text x="${W / 2}" y="${H / 2}" text-anchor="middle" class="c-empty">${esc(spec.empty || '—')}</text>`;
    st.prev = null; return;
  }
  const rev = !!spec.reverse;
  const max = spec.max ?? niceMax(Math.max(...all) * 1.08), min = spec.min ?? 0;
  const target = spec.series.map((s) => resample(s.values, n));
  const from = st.prev && st.prev.length === target.length ? st.prev.map((v) => resample(v, n)) : null;
  const fromMax = st.max ?? max;
  st.prev = target; st.max = max; st.min = min; st.n = n;

  const frame = (p) => {
    const m = fromMax + (max - fromMax) * p;
    const x = (i) => PAD.l + (i / Math.max(1, n - 1)) * (W - PAD.l - PAD.r);
    const y = (v) => {
      const k = (v - min) / ((m - min) || 1);
      return rev ? PAD.t + k * (H - PAD.t - PAD.b) : H - PAD.b - k * (H - PAD.t - PAD.b);
    };
    st.x = x; st.y = y;
    const vals = target.map((t, si) => t.map((v, i) => {
      if (!from || p >= 1) return v;
      const a = from[si]?.[i];
      return v == null ? null : a == null ? v : a + (v - a) * p;
    }));
    const ticks = [0, 0.5, 1].map((k) => min + (m - min) * k);
    const fmt = spec.format || ((v) => num(v));
    const grid = ticks.map((v) => `<line class="c-grid" x1="${PAD.l}" x2="${W - PAD.r}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/><text class="c-axis" x="${PAD.l - 8}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${esc(fmt(v, true))}</text>`).join('');
    const labelIdx = n <= 1 ? [0] : [0, Math.round((n - 1) / 2), n - 1];
    const xl = labelIdx.map((i, k) => `<text class="c-axis" x="${x(i).toFixed(1)}" y="${H - 6}" text-anchor="${k === 0 ? 'start' : k === labelIdx.length - 1 ? 'end' : 'middle'}">${esc(date(spec.dates[i]))}</text>`).join('');
    const ev = (spec.events || []).map((e) => {
      const i = spec.dates.indexOf(e.date); if (i < 0) return '';
      return `<g class="c-event ${esc(e.type)}"><line x1="${x(i).toFixed(1)}" x2="${x(i).toFixed(1)}" y1="${PAD.t}" y2="${H - PAD.b}"/><path d="M${x(i).toFixed(1)} ${H - PAD.b - 5}l5 5-5 5-5-5z"/></g>`;
    }).join('');
    const lines = spec.series.map((s, si) => {
      const d = pathOf(vals[si], x, y);
      const area = s.area ? `<path class="c-area" d="${areaOf(vals[si], x, y, (rev ? PAD.t : H - PAD.b).toFixed(1))}" style="fill:${s.color}"/>` : '';
      return `${area}<path class="c-line${s.dashed ? ' dashed' : ''}" d="${d}" style="stroke:${s.color}" pathLength="1000" data-s="${si}"/>`;
    }).join('');
    svg.innerHTML = grid + xl + ev + lines + `<g class="c-hover" hidden><line class="c-cross" y1="${PAD.t}" y2="${H - PAD.b}"/>${spec.series.map((s) => `<circle r="4.5" style="stroke:${s.color}"/>`).join('')}</g>`;
  };

  cancelAnimationFrame(st.raf);
  if (!from || reduced()) {
    frame(1);
    if (!from && !reduced()) svg.querySelectorAll('.c-line:not(.dashed)').forEach((pth) => pth.classList.add('draw'));
    return;
  }
  const t0 = performance.now(), dur = 520;
  const step = (now) => {
    const p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 3);
    frame(e);
    if (p < 1) st.raf = requestAnimationFrame(step);
  };
  st.raf = requestAnimationFrame(step);
}

function bindHover(el, st) {
  const tip = () => el.querySelector('.chart-tip');
  const move = (clientX) => {
    const spec = st.spec; if (!spec || !st.x || !st.prev) return;
    const svg = el.querySelector('svg'), box = svg.getBoundingClientRect();
    const vx = ((clientX - box.left) / box.width) * W;
    const i = Math.max(0, Math.min(st.n - 1, Math.round(((vx - PAD.l) / (W - PAD.l - PAD.r)) * (st.n - 1))));
    const g = svg.querySelector('.c-hover'); if (!g) return;
    g.hidden = false;
    const cx = st.x(i);
    g.querySelector('line').setAttribute('x1', cx); g.querySelector('line').setAttribute('x2', cx);
    g.querySelectorAll('circle').forEach((c, si) => {
      const v = st.prev[si]?.[i];
      if (v == null) c.setAttribute('visibility', 'hidden');
      else { c.removeAttribute('visibility'); c.setAttribute('cx', cx); c.setAttribute('cy', st.y(v)); }
    });
    const fmt = spec.format || ((v) => num(v));
    const evs = (spec.events || []).filter((e) => e.date === spec.dates[i]);
    const t = tip();
    t.hidden = false;
    t.innerHTML = `<strong>${esc(date(spec.dates[i], { weekday: 'short', day: '2-digit', month: 'short' }))}</strong>` +
      spec.series.map((s, si) => `<span><i style="background:${s.color}"></i>${esc(s.label)}<b>${st.prev[si]?.[i] == null ? '—' : esc(fmt(st.prev[si][i]))}</b></span>`).join('') +
      evs.map((e) => `<em>◆ ${esc(e.label)}</em>`).join('');
    const left = (cx / W) * box.width;
    t.style.transform = `translateX(${Math.min(box.width - t.offsetWidth, Math.max(0, left - t.offsetWidth / 2))}px)`;
  };
  const leave = () => { const g = el.querySelector('.c-hover'); if (g) g.hidden = true; tip().hidden = true; };
  el.addEventListener('pointermove', (e) => move(e.clientX));
  el.addEventListener('pointerleave', leave);
  el.tabIndex = 0;
  let k = -1;
  el.addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(e.key) || !st.n) return;
    e.preventDefault();
    k = Math.max(0, Math.min(st.n - 1, (k < 0 ? st.n - 1 : k) + (e.key === 'ArrowRight' ? 1 : -1)));
    const box = el.querySelector('svg').getBoundingClientRect();
    move(box.left + (st.x(k) / W) * box.width);
  });
  el.addEventListener('blur', leave);
}

export function sparkline(values, { w = 120, h = 32, color = 'currentColor', max } = {}) {
  const vs = values.filter((v) => v != null);
  if (!vs.length) return `<svg class="spark" viewBox="0 0 ${w} ${h}" aria-hidden="true"><line x1="0" x2="${w}" y1="${h - 2}" y2="${h - 2}" class="spark-none"/></svg>`;
  const m = max || Math.max(...vs) || 1;
  const x = (i) => (i / Math.max(1, values.length - 1)) * (w - 2) + 1, y = (v) => h - 2 - (v / m) * (h - 5);
  const d = pathOf(values, x, y);
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><path d="${areaOf(values, x, y, h)}" class="spark-area" style="fill:${color}"/><path d="${d}" class="spark-line" style="stroke:${color}"/></svg>`;
}
