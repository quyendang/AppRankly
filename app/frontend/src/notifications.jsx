import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowDownRight, ArrowUpRight, ArrowRight, Check, Trash2, Inbox, Flag, MessageSquare, TrendingUp, FileText, Info } from "lucide-react";
import { Dialog, Button } from "./components.jsx";

const TYPES = ["all", "changes", "reviewsKind", "system"];
const KIND_ICON = { stats: TrendingUp, anomaly: TrendingUp, rank: Flag, review: MessageSquare, digest: FileText, system: Info };
const GROUP_OF = { stats: "changes", anomaly: "changes", rank: "changes", digest: "changes", review: "reviewsKind", system: "system" };

// Old notifications have no structured data; show their text with line breaks kept.
export const kindOf = (n) => n.data?.kind || "system";
export const groupOf = (n) => GROUP_OF[kindOf(n)] || "system";

function dayKey(iso) {
  const d = new Date(iso), now = new Date();
  const start = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(now) - start(d)) / 86400000);
  return diff <= 0 ? "today" : diff === 1 ? "yesterday" : "earlier";
}

function Change({ value, number, bare }) {
  if (value == null) return <span className="n-change none">—</span>;
  const dir = value > 0.05 ? "up" : value < -0.05 ? "down" : "flat";
  const Icon = dir === "down" ? ArrowDownRight : ArrowUpRight;
  return (
    <span className={"n-change " + dir}>
      {dir !== "flat" && <Icon className="icon" aria-hidden="true" />}
      {(value > 0.05 ? "+" : value < -0.05 ? "−" : "") + number(Math.abs(value), Math.abs(value) < 10 ? 1 : 0)}{bare ? "" : "%"}
    </span>
  );
}

function MetricRow({ item, number, onOpen, t }) {
  const main = item.metrics?.[0], rest = item.metrics?.slice(1) || [];
  const label = (m) => (m.key === "rank" ? t("rank") : m.key === "rating" ? t("rating") : m.key === "revenue" ? t("revenue") : m.key === "uninstalls" ? t("uninstalls") : t("installs"));
  const fmt = (m) => (m.value == null ? "—" : m.key === "rank" ? "#" + number(m.value) : number(m.value, m.key === "revenue" ? 2 : 0) + (m.unit && m.key === "revenue" ? " " + m.unit : ""));
  return (
    <li className="n-row">
      <button type="button" className="n-app" onClick={() => item.appId && onOpen(item.appId, item.tab || "overview")} disabled={!item.appId}>
        <strong>{item.name}</strong>
        {item.term && <small>“{item.term}”{item.country ? " · " + item.country.toUpperCase() : ""}</small>}
      </button>
      <div className="n-metrics">
        {main && (
          <span className="n-metric main">
            <small>{label(main)}</small>
            <b>{fmt(main)}</b>
            {main.previous != null && <em>{t("notifFrom", { value: main.key === "rank" ? "#" + number(main.previous) : number(main.previous, main.key === "revenue" ? 2 : 0) })}</em>}
            <Change value={main.change} number={number} bare={main.key === "rank"} />
          </span>
        )}
        {rest.map((m) => (
          <span className="n-metric" key={m.key}>
            <small>{label(m)}</small>
            <b>{fmt(m)}</b>
            {m.change != null && <Change value={m.change} number={number} />}
          </span>
        ))}
      </div>
      {item.note && <p className="n-note">{item.note}</p>}
    </li>
  );
}

function Item({ n, number, formatTime, onRead, onDelete, onOpen, t }) {
  const [open, setOpen] = useState(false);
  const d = n.data, kind = kindOf(n), Icon = KIND_ICON[kind] || Info;
  const items = d?.items || [];
  const shown = open ? items : items.slice(0, 4);
  return (
    <article className={"notif " + (n.read ? "read" : "unread") + (d?.severity ? " sev-" + d.severity : "")}>
      <span className="n-icon" aria-hidden="true"><Icon className="icon" /></span>
      <div className="n-body">
        <header>
          <h3>{d ? t("notifKind_" + kind) : n.title}</h3>
          <time>{formatTime(n.timestamp)}</time>
        </header>
        {d && items.length ? (
          <>
            <ul className="n-rows">
              {shown.map((item, i) => <MetricRow key={(item.appId || item.name) + i} item={item} number={number} onOpen={onOpen} t={t} />)}
            </ul>
            {items.length > 4 && <button type="button" className="text-button" onClick={() => setOpen(!open)}>{open ? t("showLess") : t("showMore", { count: items.length - 4 })}</button>}
          </>
        ) : (
          <p className="n-text">{n.message}</p>
        )}
        {!!d?.hints?.length && (
          <div className="n-hints">
            <span>{t("notifNext")}</span>
            {d.hints.map((h) => (
              <button type="button" key={h.key + (h.appId || "")} className="n-hint" onClick={() => onOpen(h.appId, h.tab || "overview")}>
                {t("hint_" + h.key, { defaultValue: h.key })}<ArrowRight className="icon" aria-hidden="true" />
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="n-actions">
        {!n.read && <button type="button" className="icon-button" aria-label={t("markRead")} title={t("markRead")} onClick={() => onRead(n.id)}><Check className="icon" /></button>}
        <button type="button" className="icon-button" aria-label={t("delete")} title={t("delete")} onClick={() => onDelete(n.id)}><Trash2 className="icon" /></button>
      </div>
    </article>
  );
}

export function NotificationsDialog({ notifications, busy, number, formatTime, onClose, onRead, onReadAll, onDelete, onOpen }) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState("all");
  const counts = useMemo(() => {
    const c = { all: notifications.length };
    for (const n of notifications) c[groupOf(n)] = (c[groupOf(n)] || 0) + 1;
    return c;
  }, [notifications]);
  const list = notifications.filter((n) => filter === "all" || groupOf(n) === filter);
  const groups = ["today", "yesterday", "earlier"].map((g) => [g, list.filter((n) => dayKey(n.timestamp) === g)]).filter(([, items]) => items.length);
  const unread = notifications.filter((n) => !n.read).length;
  return (
    <Dialog title={t("notifications")} onClose={onClose} wide>
      <div className="notif-bar">
        <div className="segmented" role="group" aria-label={t("filter")}>
          {TYPES.map((k) => (
            <button type="button" key={k} aria-pressed={filter === k} onClick={() => setFilter(k)}>
              {t("notifType_" + k)}{!!counts[k] && <small>{counts[k]}</small>}
            </button>
          ))}
        </div>
        <Button icon={Check} disabled={busy || !unread} onClick={onReadAll}>{t("readNotifications")}</Button>
      </div>
      {!list.length ? (
        <div className="notif-empty"><Inbox className="icon" /><p>{t(notifications.length ? "notifNoneInFilter" : "noNotifications")}</p></div>
      ) : (
        <div className="notif-groups">
          {groups.map(([g, items]) => (
            <section key={g}>
              <h4>{t("notifDay_" + g)}</h4>
              {items.map((n) => <Item key={n.id} n={n} number={number} formatTime={formatTime} onRead={onRead} onDelete={onDelete} onOpen={onOpen} t={t} />)}
            </section>
          ))}
        </div>
      )}
    </Dialog>
  );
}
