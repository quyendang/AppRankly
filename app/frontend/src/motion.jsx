import React, { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";

export const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

// Wraps a state update in a View Transition when the browser supports it.
export function transition(update, kind) {
  if (!document.startViewTransition || reducedMotion()) { update(); return; }
  if (kind) document.documentElement.dataset.vt = kind;
  // flushSync must run inside the callback so React commits before the "after" snapshot.
  // Controlled inputs are updated by the caller first (see setNow) so they never lag behind.
  const vt = document.startViewTransition(() => { flushSync(update); });
  vt.finished.catch(() => {}).finally(() => { delete document.documentElement.dataset.vt; });
}

// Counts from the previous value to the new one instead of jumping.
export function Num({ value, format }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value), frame = useRef(0);
  useEffect(() => {
    cancelAnimationFrame(frame.current);
    const start = from.current;
    if (!Number.isFinite(value) || !Number.isFinite(start) || start === value || reducedMotion()) {
      from.current = value; setShown(value); return;
    }
    const t0 = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - t0) / 650), e = 1 - Math.pow(1 - p, 4);
      const v = start + (value - start) * e;
      from.current = v; setShown(v);
      if (p < 1) frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame.current);
  }, [value]);
  return <span className="tnum">{format(shown)}</span>;
}

// Small toast store; toast() can be called from anywhere.
let toasts = [], seq = 0;
const listeners = new Set();
const emit = () => listeners.forEach((l) => l());
export function toast(text, { tone = "ok", undo, undoLabel } = {}) {
  const id = ++seq;
  toasts = [...toasts, { id, text, tone, undo, undoLabel }];
  emit();
  setTimeout(() => dismissToast(id), undo ? 6500 : 4000);
}
export function dismissToast(id) {
  toasts = toasts.filter((x) => x.id !== id);
  emit();
}
export function Toasts({ closeLabel }) {
  const list = useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => toasts);
  return (
    <div className="toasts" aria-live="polite">
      {list.map((x) => (
        <div key={x.id} className={"toast " + x.tone} role={x.tone === "err" ? "alert" : "status"}>
          <span>{x.text}</span>
          {x.undo && <button type="button" onClick={() => { x.undo(); dismissToast(x.id); }}>{x.undoLabel}</button>}
          <button type="button" className="toast-x" aria-label={closeLabel} onClick={() => dismissToast(x.id)}>×</button>
        </div>
      ))}
    </div>
  );
}

export function Skel({ w = "100%", h = "1em", round }) {
  return <span className={"skel" + (round ? " round" : "")} style={{ width: w, height: h }} aria-hidden="true" />;
}
