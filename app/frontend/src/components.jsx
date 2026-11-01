import { trendSeries, sparkSegments } from "./series.js";
import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
  Filler,
} from "chart.js";
import { Line } from "react-chartjs-2";
import {
  ArrowUpRight,
  ArrowDownRight,
  X,
  ArrowRight,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
  Filler,
);
export function Button({
  children,
  icon: Icon,
  onClick,
  primary = false,
  ...props
}) {
  return (
    <button
      className={"button" + (primary ? " primary" : "")}
      onClick={onClick}
      {...props}
    >
      {Icon && <Icon className="icon" />}
      {children}
    </button>
  );
}
export function Avatar({ app }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [app.id, app.iconAvailable]);
  const colors = ["#A64B32", "#9B7025", "#8F422E"];
  const index = [...app.name].reduce((s, c) => s + c.charCodeAt(0), 0) % 3;
  return (
    <>
      {app.iconAvailable && !failed ? (
        <img
          className="app-avatar app-logo"
          src={"/api/apps/icon/" + encodeURIComponent(app.id)}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        <span
          className="app-avatar"
          aria-hidden="true"
          style={{ "--app-color": colors[index] }}
        >
          {app.name.slice(0, 1).toUpperCase()}
        </span>
      )}
      <span className="app-name">
        <strong>{app.name}</strong>
        <small className="platform-label">
          <svg className="platform-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            {app.platform === "apple" ? <path d="M17.05 12.54c.03 3.1 2.72 4.13 2.75 4.14-.02.07-.43 1.47-1.42 2.92-.86 1.25-1.75 2.5-3.15 2.53-1.38.03-1.82-.82-3.4-.82-1.57 0-2.06.8-3.36.85-1.35.05-2.38-1.35-3.25-2.6-1.77-2.57-3.12-7.28-1.3-10.45a5.05 5.05 0 0 1 4.28-2.6c1.34-.02 2.6.9 3.4.9s2.3-1.12 3.88-.96c.66.03 2.52.27 3.72 2.04-.1.06-2.22 1.29-2.2 4.05ZM14.46 4.7c.72-.87 1.2-2.08 1.07-3.28-1.03.04-2.28.69-3.02 1.56-.66.77-1.24 2-1.08 3.18 1.15.09 2.32-.59 3.03-1.46Z" /> : <path d="m17.52 7.38 1.67-2.89a.35.35 0 0 0-.13-.48.35.35 0 0 0-.48.13l-1.69 2.93a10.4 10.4 0 0 0-9.78 0L5.42 4.14a.35.35 0 0 0-.61.35l1.67 2.89A9.43 9.43 0 0 0 2 15.5h20a9.43 9.43 0 0 0-4.48-8.12ZM7.5 12a1 1 0 1 1 0-2 1 1 0 0 1 0 2Zm9 0a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z" />}
          </svg>
          {app.platform === "apple" ? "iOS · App Store" : "Android · Google Play"}
        </small>
      </span>
    </>
  );
}
export function Change({ value }) {
  const { t, i18n } = useTranslation();
  if (value == null)
    return (
      <span className="muted" title={t("changeUnavailable")}>
        —
      </span>
    );
  if (value === 0) return <span className="delta muted">0%</span>;
  const Icon = value < 0 ? ArrowDownRight : ArrowUpRight;
  return (
    <span className={"delta " + (value < 0 ? "negative" : "positive")}>
      <Icon className="icon" />
      {new Intl.NumberFormat(i18n.language, {
        maximumFractionDigits: 1,
      }).format(Math.abs(value))}
      %
    </span>
  );
}
export function Empty({ title, text, action }) {
  const { t } = useTranslation();
  return (
    <section className="empty-state">
      <ShieldCheck className="icon" />
      <h2>{t(title)}</h2>
      <p>{t(text)}</p>
      {action}
    </section>
  );
}
export function Panel({
  title,
  description,
  action,
  children,
  className = "",
}) {
  return (
    <section className={"panel " + className}>
      <div className="panel-heading">
        <div>
          <h2>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
export function Chart({ apps, previous = [], theme, range }) {
  const { t, i18n } = useTranslation();
  const { dates, values, old } = trendSeries(apps, previous, range);
  if (!values.some(Number.isFinite))
    return <p className="content-message">{t("noActualData")}</p>;
  const dark = theme === "dark",
    color = dark ? "#F3A77C" : "#B84F2B",
    muted = dark ? "#B9B1CD" : "#666177";
  const data = {
    labels: dates.map((d) =>
      new Intl.DateTimeFormat(i18n.language, {
        day: "2-digit",
        month: "2-digit",
        timeZone: "UTC",
      }).format(new Date(d + "T12:00:00Z")),
    ),
    datasets: [
      {
        label: t("currentPeriod"),
        data: values,
        borderColor: color,
        backgroundColor: color + "22",
        fill: "origin",
        pointStyle: "circle",
        borderWidth: 2.5,
        pointRadius: 0,
        pointHoverRadius: 4,
        tension: 0.2,
      },
      ...(old.some(Number.isFinite)
        ? [
            {
              label: t("previousPeriod"),
              data: old,
              borderColor: muted,
              backgroundColor: muted,
              borderDash: [5, 5],
              borderWidth: 1.5,
              pointStyle: "line",
              pointRadius: 0,
              tension: 0.2,
            },
          ]
        : []),
    ],
  };
  return (
    <div className="production-chart">
      <Line
        data={data}
        options={{
          responsive: true,
          maintainAspectRatio: false,
          animation: matchMedia("(prefers-reduced-motion: reduce)").matches
            ? false
            : { duration: 180 },
          interaction: { intersect: false, mode: "index" },
          plugins: {
            legend: {
              position: "top",
              align: "end",
              labels: {
                color: muted,
                usePointStyle: true,
                boxWidth: 18,
                boxHeight: 8,
                padding: 16,
                font: { family: "Be Vietnam Pro", size: 11 },
              },
            },
          },
          scales: {
            x: {
              grid: { display: false },
              ticks: { maxTicksLimit: 6, color: muted, font: { size: 11 } },
            },
            y: {
              beginAtZero: true,
              grid: { color: dark ? "#3B354E" : "#E8E5F0" },
              ticks: { maxTicksLimit: 5, color: muted, font: { size: 11 } },
            },
          },
        }}
        role="img"
        aria-label={t("trend")}
      />
    </div>
  );
}
export function Sparkline({ values, max = 1, label, tone = "accent" }) {
  if (!values?.length) return <span className="muted">—</span>;
  const segments = sparkSegments(values, max);
  if (!segments.length) return <span className="muted">—</span>;
  return (
    <svg
      className="production-spark"
      viewBox="0 0 150 40"
      role="img"
      aria-label={label}
    >
      {segments.map((points, index) => (
        <polyline
          key={index}
          points={points}
          fill="none"
          stroke={`var(--${tone})`}
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      ))}
      <circle
        cx={segments.at(-1).split(" ").at(-1).split(",")[0]}
        cy={segments.at(-1).split(" ").at(-1).split(",")[1]}
        r="3"
        fill={`var(--${tone})`}
      />
    </svg>
  );
}
export function Dialog({ title, onClose, children, drawer = false }) {
  const { t } = useTranslation();
  const ref = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    ref.current?.querySelector("input,button,select,textarea")?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, []);
  function keyDown(event) {
    if (event.key === "Escape") onClose();
    if (event.key !== "Tab") return;
    const items = [
      ...ref.current.querySelectorAll(
        "button:not([disabled]),input,select,textarea,a[href]",
      ),
    ];
    if (event.shiftKey && document.activeElement === items[0]) {
      event.preventDefault();
      items.at(-1)?.focus();
    } else if (!event.shiftKey && document.activeElement === items.at(-1)) {
      event.preventDefault();
      items[0]?.focus();
    }
  }
  return (
    <div
      className={drawer ? "modal-backdrop drawer-backdrop" : "modal-backdrop"}
    >
      <section
        ref={ref}
        className={drawer ? "modal detail-drawer" : "modal"}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        onKeyDown={keyDown}
      >
        <div className="modal-heading">
          <h2 id="dialog-title">{title}</h2>
          <button
            className="icon-button close-modal"
            aria-label={t("close")}
            onClick={onClose}
          >
            <X className="icon" />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}
export function Tabs({ items, value, onChange }) {
  const { t } = useTranslation();
  return (
    <div className="tabs" role="tablist">
      {items.map((key, i) => (
        <button
          key={key}
          role="tab"
          aria-selected={value === key}
          tabIndex={value === key ? 0 : -1}
          className={"tab " + (value === key ? "active" : "")}
          onClick={() => onChange(key)}
          onKeyDown={(e) => {
            if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
              e.preventDefault();
              const n =
                e.key === "Home"
                  ? 0
                  : e.key === "End"
                    ? items.length - 1
                    : (i + (e.key === "ArrowLeft" ? -1 : 1) + items.length) %
                      items.length;
              onChange(items[n]);
              e.currentTarget.parentElement.children[n].focus();
            }
          }}
        >
          {t(key)}
        </button>
      ))}
    </div>
  );
}
export function FormField({ label, children }) {
  return (
    <div className="form-field">
      <label>
        {label}
        {children}
      </label>
    </div>
  );
}
export async function api(url, { method = "GET", body, signal } = {}) {
  let response;
  try {
    response = await fetch(url, {
      method,
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal,
    });
  } catch (error) {
    if (error.name === "AbortError") throw error;
    throw new Error("NETWORK_ERROR");
  }
  const result = await response
    .json()
    .catch(() => ({ error: "OPERATION_FAILED" }));
  if (!response.ok) throw new Error(result.error || "OPERATION_FAILED");
  return result;
}
export function csvDownload(apps, t) {
  const rows = [
    [
      t("appColumn"),
      t("platform"),
      t("installs"),
      t("revenue"),
      t("originCurrency"),
      t("revenueBasis"),
    ],
  ];
  for (const app of apps) {
    const entries = Object.entries((app.platform === "google" ? app.grossRevenueByCurrency : app.revenueByCurrency) || {});
    const basis = t(app.platform === "google" ? "googleGrossRevenue" : "appleNetRevenue");
    if (!entries.length)
      rows.push([app.name, app.platform, app.installs ?? "", "", "", basis]);
    else
      for (const [currency, value] of entries)
        rows.push([
          app.name,
          app.platform,
          app.installs ?? "",
          value,
          currency,
          basis,
        ]);
  }
  download(
    "apprankly.csv",
    "\uFEFF" +
      rows
        .map((row) =>
          row
            .map(
              (v) =>
                '"' +
                (typeof v === "string" && /^[=+@\-\t\r]/.test(v)
                  ? "'" + v
                  : String(v)
                ).replace(/"/g, '""') +
                '"',
            )
            .join(","),
        )
        .join("\r\n"),
    "text/csv;charset=utf-8;",
  );
}
export function download(name, text, type = "application/json") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
