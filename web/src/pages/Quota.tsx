import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { projectPace, remainingPct, type Pace, type QuotaAttributionRow, type QuotaSample, type QuotaWindow } from "@claude-monitor/shared";
import { api, subscribe } from "../api";
import { Icon, type IconName } from "../components/Icon";
import { QuotaHistoryChart, type Projection } from "../components/QuotaHistoryChart";
import { formatAgo, formatCost, formatDuration, formatTokens, projectName, useNow } from "../format";
import { notificationsSupported } from "../state/alerts";
import { useLive } from "../state/live";

const FIVE_HOURS = 5 * 3_600_000;
const HISTORY_DAYS = 7;
const ATTRIBUTION_REFRESH_MS = 30_000;
const FIVE_LOOKBACK = 60 * 60_000;
const WEEK_LOOKBACK = 24 * 3_600_000;
/** The weekly projection is drawn at most this far ahead, so the 7-day chart stays readable. */
const WEEK_PROJECTION_MAX = 24 * 3_600_000;
const NO_ALERTS: number[] = [];

type Level = "good" | "warning" | "critical";
const level = (left: number): Level => (left <= 10 ? "critical" : left <= 30 ? "warning" : "good");
const LEVEL_LABEL: Record<Level, string> = { good: "OK", warning: "Getting low", critical: "Almost out" };
const LEVEL_ICON: Record<Level, IconName> = { good: "ok", warning: "warning", critical: "error" };
const LEVEL_COLOR: Record<Level, string> = { good: "var(--teal)", warning: "var(--amber)", critical: "var(--rose)" };

function resetText(w: QuotaWindow, now: number): string | null {
  if (!w.resetsAt) return null;
  const at = Date.parse(w.resetsAt);
  const when = new Date(at).toLocaleString("en-US", { weekday: "short", hour: "2-digit", minute: "2-digit" });
  return at > now ? `Resets in ${formatDuration(at - now)} (${when})` : `Reset due ${when}`;
}

function paceText(pace: Pace | undefined, now: number): string {
  if (pace === undefined) return "Pace: needs a few more readings.";
  if (!pace.exhaustAt) return `Pace: about flat (${pace.ratePctPerHour.toFixed(1)} pts/h).`;
  if (pace.beforeReset === false) return `Pace: ${pace.ratePctPerHour.toFixed(1)} pts/h. At this rate it lasts until the reset.`;
  return `Pace: ${pace.ratePctPerHour.toFixed(1)} pts/h. At this rate it runs out in ~${formatDuration(Date.parse(pace.exhaustAt) - now)}${pace.beforeReset ? ", before the reset" : ""}.`;
}

/** Ring of the percentage left, colored by level. */
function Gauge({ left, lv, label }: { left: number; lv: Level; label: string }) {
  const r = 56;
  const c = 2 * Math.PI * r;
  return (
    <svg width={140} height={140} viewBox="0 0 140 140" role="img" aria-label={`${label}: ${Math.round(left)} percent left, ${LEVEL_LABEL[lv]}`} className="gauge">
      <circle cx={70} cy={70} r={r} fill="none" stroke="rgba(0,0,0,.35)" strokeWidth={12} />
      <circle
        cx={70}
        cy={70}
        r={r}
        fill="none"
        stroke={LEVEL_COLOR[lv]}
        strokeWidth={12}
        strokeLinecap="round"
        strokeDasharray={`${(left / 100) * c} ${c}`}
        transform="rotate(-90 70 70)"
      />
      <text x={70} y={70} textAnchor="middle" className="ring-value">
        {Math.round(left)}%
      </text>
      <text x={70} y={90} textAnchor="middle" className="ring-label">
        left
      </text>
    </svg>
  );
}

function WindowCard({ title, w, pace, now }: { title: string; w?: QuotaWindow; pace: Pace | undefined; now: number }) {
  if (!w) {
    return (
      <div className="card quota-card">
        <h2>{title}</h2>
        <p className="empty">No reading for this window.</p>
      </div>
    );
  }
  const left = remainingPct(w)!;
  const lv = level(left);
  return (
    <div className="card quota-card">
      <div className="chart-head">
        <h2>{title}</h2>
        <span className={`chip chip-${lv}`}>
          <Icon name={LEVEL_ICON[lv]} size={14} />
          {LEVEL_LABEL[lv]}
        </span>
      </div>
      <div className="gauge-row">
        <Gauge left={left} lv={lv} label={title} />
        <div className="gauge-facts">
          <div>
            <strong>{Math.round(w.usedPct)}%</strong> <span className="muted">used</span>
          </div>
          {resetText(w, now) && (
            <div className="muted small gauge-reset">
              <Icon name="time" size={14} />
              {resetText(w, now)}
            </div>
          )}
          <p className="quota-pace">
            {paceText(pace, now)}
            <span className="muted small"> Estimate.</span>
          </p>
        </div>
      </div>
    </div>
  );
}

function PermissionChip({ permission }: { permission: string }) {
  const map: Record<string, { cls: string; icon: IconName; text: string }> = {
    granted: { cls: "chip-good", icon: "ok", text: "Notifications on" },
    default: { cls: "chip-warning", icon: "bell", text: "Not enabled yet" },
    denied: { cls: "chip-critical", icon: "error", text: "Blocked by the browser" },
    unsupported: { cls: "", icon: "input", text: "Not supported" },
  };
  const m = map[permission] ?? map.unsupported!;
  return (
    <span className={`chip ${m.cls}`}>
      <Icon name={m.icon} size={14} />
      {m.text}
    </span>
  );
}

function AlertsCard() {
  // Select the stored array itself: a fresh `[]` per read would re-render forever.
  const thresholds = useLive((s) => s.meta?.quotaAlerts) ?? NO_ALERTS;
  const [permission, setPermission] = useState(() => (notificationsSupported() ? Notification.permission : "unsupported"));
  const ask = (): void => {
    void Notification.requestPermission().then(setPermission);
  };
  return (
    <section className="card">
      <div className="chart-head wrap">
        <h2>Alerts</h2>
        {thresholds.length > 0 && <PermissionChip permission={permission} />}
      </div>
      {!thresholds.length ? (
        <p className="muted">Off. Set CLAUDE_MONITOR_QUOTA_ALERTS in .env to turn them on.</p>
      ) : (
        <>
          <div className="alert-thresholds">
            <span className="muted small">Notify when a window drops to</span>
            {thresholds.map((t) => (
              <span key={t} className="chip">
                <Icon name="bell" size={14} />
                {t}% left
              </span>
            ))}
          </div>
          <p className="muted small">Change it with CLAUDE_MONITOR_QUOTA_ALERTS in .env. Notifications only fire while a monitor tab is open.</p>
          {permission === "default" && (
            <button className="btn btn-primary" onClick={ask}>
              <Icon name="bell" size={16} />
              Enable notifications
            </button>
          )}
          {permission === "denied" && <p className="muted small">Allow notifications for the monitor in the browser's site settings.</p>}
        </>
      )}
    </section>
  );
}

export function QuotaPage() {
  const quota = useLive((s) => s.quota);
  const configured = useLive((s) => s.meta?.quotaConfigured ?? false);
  const thresholds = useLive((s) => s.meta?.quotaAlerts) ?? NO_ALERTS;
  const [history, setHistory] = useState<QuotaSample[]>([]);
  const [attribution, setAttribution] = useState<QuotaAttributionRow[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const now = useNow();

  const windowStart = useMemo(() => {
    const reset = quota?.fiveHour?.resetsAt ? Date.parse(quota.fiveHour.resetsAt) : NaN;
    return new Date(Number.isFinite(reset) ? reset - FIVE_HOURS : Date.now() - FIVE_HOURS).toISOString();
  }, [quota?.fiveHour?.resetsAt]);

  const loadHistory = useCallback(() => {
    api.quotaHistory(HISTORY_DAYS).then(setHistory).catch(() => undefined);
  }, []);
  const loadAttribution = useCallback(() => {
    api.quotaAttribution(windowStart).then(setAttribution).catch(() => undefined);
  }, [windowStart]);

  useEffect(() => {
    loadHistory();
    return subscribe((m) => {
      if (m.type === "quota_updated") loadHistory();
    }, loadHistory);
  }, [loadHistory]);

  useEffect(() => {
    loadAttribution();
    const id = setInterval(loadAttribution, ATTRIBUTION_REFRESH_MS);
    return () => clearInterval(id);
  }, [loadAttribution]);

  const refresh = (): void => {
    setRefreshing(true);
    api
      .refreshQuota()
      .catch(() => undefined)
      .finally(() => setRefreshing(false));
  };

  const fiveSamples = useMemo(() => history.flatMap((s) => (s.fiveHour === null ? [] : [{ ts: s.ts, usedPct: s.fiveHour }])), [history]);
  const weekSamples = useMemo(() => history.flatMap((s) => (s.sevenDay === null ? [] : [{ ts: s.ts, usedPct: s.sevenDay }])), [history]);
  const fivePace = projectPace(fiveSamples, quota?.fiveHour, now, FIVE_LOOKBACK);
  const weekPace = projectPace(weekSamples, quota?.sevenDay, now, WEEK_LOOKBACK);

  // Recomputed once a minute, not every tick, so the chart does not redraw each second.
  const minute = Math.floor(now / 60_000);
  const projections = useMemo<Projection[]>(() => {
    const at = minute * 60_000;
    const out: Projection[] = [];
    const add = (key: Projection["key"], w: QuotaWindow | undefined, pace: Pace | undefined, maxAhead: number) => {
      if (!w?.resetsAt || !pace) return;
      const end = Math.min(Date.parse(w.resetsAt), at + maxAhead);
      if (!(end > at)) return;
      out.push({ key, from: { t: at, used: w.usedPct }, to: { t: end, used: w.usedPct + (pace.ratePctPerHour * (end - at)) / 3_600_000 } });
    };
    add("fiveHour", quota?.fiveHour, fivePace, FIVE_HOURS);
    add("sevenDay", quota?.sevenDay, weekPace, WEEK_PROJECTION_MAX);
    return out;
    // The paces come from quota and history; the minute keeps the chart from redrawing every second.
  }, [minute, quota, history]);

  const totalCost = attribution?.reduce((sum, r) => sum + r.costUsd, 0) ?? 0;
  const maxCost = Math.max(0, ...(attribution ?? []).map((r) => r.costUsd));

  if (!quota || quota.status === "not_configured") {
    return (
      <section className="card">
        <h2>Quota not configured</h2>
        <p>The monitor can read your subscription's 5-hour and weekly limits in two ways:</p>
        <ul>
          <li>
            Put an OAuth token in <code>CLAUDE_CODE_OAUTH_TOKEN</code> in <code>.env</code> (get one with <code>claude setup-token</code>) and restart the monitor.
          </li>
          <li>
            Or install the statusline feed with <code>npm run hooks:install -- --write --statusline</code>. It updates the quota from CLI sessions only.
          </li>
        </ul>
      </section>
    );
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Quota</h1>
          <div className="muted">
            {quota.fetchedAt ? `Updated ${formatAgo(quota.fetchedAt, now)} from ${quota.source}` : "No reading yet"}
            {quota.status === "error" && <span className="error"> · Last refresh failed: {quota.error ?? "unknown error"}</span>}
          </div>
        </div>
        {configured && (
          <button className="btn" onClick={refresh} disabled={refreshing}>
            <Icon name="refresh" size={16} />
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        )}
      </div>

      <div className="quota-grid">
        <WindowCard title="5-hour window" w={quota.fiveHour} pace={fivePace} now={now} />
        <WindowCard title="Weekly window" w={quota.sevenDay} pace={weekPace} now={now} />
      </div>

      {quota.sevenDayByModel && (
        <section className="card">
          <h2>Weekly, by model</h2>
          {Object.entries(quota.sevenDayByModel).map(([model, w]) => {
            const left = remainingPct(w)!;
            const lv = level(left);
            return (
              <div key={model} className="quota-row">
                <span className="quota-row-label">{model}</span>
                <div className="meter-wrap">
                  <div className="meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(w.usedPct)} aria-label={`${model} weekly used`}>
                    <div className={`meter-fill meter-${lv}`} style={{ width: `${Math.min(100, w.usedPct)}%` }} />
                  </div>
                  {thresholds.map((t) => (
                    <span key={t} className="meter-mark" style={{ left: `${100 - t}%` }} title={`Alert at ${t}% left`} aria-hidden="true" />
                  ))}
                </div>
                <span className={`num qc-${lv}`}>
                  {Math.round(left)}% left · {LEVEL_LABEL[lv]}
                </span>
              </div>
            );
          })}
          {thresholds.length > 0 && <p className="note">Marks show the alert thresholds ({thresholds.map((t) => `${t}%`).join(", ")} left).</p>}
        </section>
      )}

      <section className="card">
        <h2>Used over the last {HISTORY_DAYS} days</h2>
        <QuotaHistoryChart samples={history} projections={projections} now={minute * 60_000} />
      </section>

      <section className="card">
        <h2>Who used the current 5-hour window</h2>
        <p className="note">
          Share of each session since {new Date(windowStart).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}, weighted by estimated API cost. Anthropic does not say how
          tokens map to quota percent, so this is a relative split, not percentage points.
        </p>
        {!attribution?.length ? (
          <p className="empty">No usage in this window yet.</p>
        ) : (
          <ol className="share-rank">
            {attribution.map((r) => {
              const share = totalCost > 0 ? r.costUsd / totalCost : 0;
              return (
                <li key={r.sessionId}>
                  <Link to={`/sessions/${r.sessionId}`} className="share-row">
                    <div className="share-top">
                      <span className="ellipsis-strong">{r.title ?? projectName(r.cwd)}</span>
                      <strong className="share-val">{totalCost > 0 ? `${Math.round(share * 100)}%` : "-"}</strong>
                    </div>
                    <span className="hbar">
                      <span style={{ width: `${maxCost ? (r.costUsd / maxCost) * 100 : 0}%`, background: "var(--ember)" }} />
                    </span>
                    <span className="muted small">
                      {projectName(r.cwd)} · {formatTokens(r.tokens)} tokens · {formatTokens(r.outputTokens)} out · {formatCost(r.costUsd)}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <AlertsCard />
    </>
  );
}
