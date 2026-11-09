import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { projectPace, remainingPct, type QuotaAttributionRow, type QuotaSample, type QuotaWindow } from "@claude-monitor/shared";
import { api, subscribe } from "../api";
import { QuotaHistoryChart } from "../components/QuotaHistoryChart";
import { formatAgo, formatCost, formatDuration, formatTokens, projectName, useNow } from "../format";
import { notificationsSupported } from "../state/alerts";
import { useLive } from "../state/live";

const FIVE_HOURS = 5 * 3_600_000;
const HISTORY_DAYS = 7;
const ATTRIBUTION_REFRESH_MS = 30_000;
const NO_ALERTS: number[] = [];

const level = (left: number): "good" | "warning" | "critical" => (left <= 10 ? "critical" : left <= 30 ? "warning" : "good");
const LEVEL_LABEL = { good: "OK", warning: "Getting low", critical: "Almost out" };

function resetText(w: QuotaWindow, now: number): string | null {
  if (!w.resetsAt) return null;
  const at = Date.parse(w.resetsAt);
  const when = new Date(at).toLocaleString("en-US", { weekday: "short", hour: "2-digit", minute: "2-digit" });
  return at > now ? `Resets in ${formatDuration(at - now)} (${when})` : `Reset due ${when}`;
}

function WindowCard({ title, w, samples, lookbackMs, now }: { title: string; w?: QuotaWindow; samples: { ts: string; usedPct: number }[]; lookbackMs: number; now: number }) {
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
  const pace = projectPace(samples, w, now, lookbackMs);
  return (
    <div className="card quota-card">
      <h2>{title}</h2>
      <div className="quota-big">
        <span className="quota-big-value">{Math.round(left)}%</span>
        <span className="muted">left</span>
        <span className={`quota-level quota-level-${lv}`}>{LEVEL_LABEL[lv]}</span>
      </div>
      <div className="meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(w.usedPct)} aria-label={`${title} used`}>
        <div className={`meter-fill meter-${lv}`} style={{ width: `${Math.min(100, Math.max(0, w.usedPct))}%` }} />
      </div>
      <div className="muted small">
        {Math.round(w.usedPct)}% used{resetText(w, now) && ` · ${resetText(w, now)}`}
      </div>
      <p className="quota-pace">
        {pace === undefined
          ? "Pace: needs a few more readings."
          : !pace.exhaustAt
            ? `Pace: about flat (${pace.ratePctPerHour.toFixed(1)} pts/h).`
            : pace.beforeReset === false
              ? `Pace: ${pace.ratePctPerHour.toFixed(1)} pts/h. At this rate it lasts until the reset.`
              : `Pace: ${pace.ratePctPerHour.toFixed(1)} pts/h. At this rate it runs out in ~${formatDuration(Date.parse(pace.exhaustAt) - now)}${pace.beforeReset ? ", before the reset" : ""}.`}
        <span className="muted small"> Estimate.</span>
      </p>
    </div>
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
      <h2>Alerts</h2>
      {!thresholds.length ? (
        <p className="muted">Off. Set CLAUDE_MONITOR_QUOTA_ALERTS in .env to turn them on.</p>
      ) : (
        <>
          <p>
            A browser notification when a window drops to {thresholds.map((t) => `${t}%`).join(" or ")} left. Change it with CLAUDE_MONITOR_QUOTA_ALERTS in .env.
          </p>
          {permission === "granted" && <p className="muted small">Notifications are on for this browser. They only fire while a monitor tab is open.</p>}
          {permission === "default" && (
            <button className="ghost" onClick={ask}>
              Enable notifications
            </button>
          )}
          {permission === "denied" && <p className="muted small">This browser blocks notifications for the monitor. Allow them in the site settings.</p>}
          {permission === "unsupported" && <p className="muted small">This browser does not support notifications.</p>}
        </>
      )}
    </section>
  );
}

export function QuotaPage() {
  const quota = useLive((s) => s.quota);
  const configured = useLive((s) => s.meta?.quotaConfigured ?? false);
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
  const totalCost = attribution?.reduce((sum, r) => sum + r.costUsd, 0) ?? 0;

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
          <button className="ghost" onClick={refresh} disabled={refreshing}>
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        )}
      </div>

      <div className="quota-grid">
        <WindowCard title="5-hour window" w={quota.fiveHour} samples={fiveSamples} lookbackMs={60 * 60_000} now={now} />
        <WindowCard title="Weekly window" w={quota.sevenDay} samples={weekSamples} lookbackMs={24 * 3_600_000} now={now} />
      </div>

      {quota.sevenDayByModel && (
        <section className="card">
          <h2>Weekly, by model</h2>
          {Object.entries(quota.sevenDayByModel).map(([model, w]) => {
            const left = remainingPct(w)!;
            return (
              <div key={model} className="quota-row">
                <span className="quota-row-label">{model}</span>
                <div className="meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(w.usedPct)} aria-label={`${model} weekly used`}>
                  <div className={`meter-fill meter-${level(left)}`} style={{ width: `${Math.min(100, w.usedPct)}%` }} />
                </div>
                <span className="num">{Math.round(left)}% left</span>
              </div>
            );
          })}
        </section>
      )}

      <section className="card">
        <h2>Used over the last {HISTORY_DAYS} days</h2>
        <QuotaHistoryChart samples={history} />
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
          <div className="table-wrap">
            <table className="rows">
              <thead>
                <tr>
                  <th>Session</th>
                  <th className="num">Share</th>
                  <th className="num">Tokens</th>
                  <th className="num">Output</th>
                  <th className="num">Est. cost</th>
                </tr>
              </thead>
              <tbody>
                {attribution.map((r) => (
                  <tr key={r.sessionId}>
                    <td className="project">
                      <Link to={`/sessions/${r.sessionId}`}>{r.title ?? projectName(r.cwd)}</Link>
                      <div className="muted ellipsis">{projectName(r.cwd)}</div>
                    </td>
                    <td className="num">{totalCost > 0 ? `${Math.round((r.costUsd / totalCost) * 100)}%` : "-"}</td>
                    <td className="num">{formatTokens(r.tokens)}</td>
                    <td className="num">{formatTokens(r.outputTokens)}</td>
                    <td className="num">{formatCost(r.costUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <AlertsCard />
    </>
  );
}
