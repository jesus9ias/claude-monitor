import { remainingPct, type Quota, type QuotaWindow } from "@claude-monitor/shared";
import { Link } from "react-router-dom";
import { formatAgo, useNow } from "../format";
import { useLive } from "../state/live";
import { Icon } from "./Icon";

type Level = "good" | "warning" | "critical";
const levelOf = (left: number): Level => (left <= 10 ? "critical" : left <= 30 ? "warning" : "good");
const LEVEL_LABEL: Record<Level, string> = { good: "OK", warning: "Getting low", critical: "Almost out" };

const resetLabel = (w?: QuotaWindow): string | undefined =>
  w?.resetsAt ? new Date(w.resetsAt).toLocaleString("en-US", { weekday: "short", hour: "2-digit", minute: "2-digit" }) : undefined;

const NOT_CONFIGURED_HINT = "Set CLAUDE_CODE_OAUTH_TOKEN in .env, or install the statusline feed";

function sourceTitle(quota: Quota, now: number): string | undefined {
  if (quota.status === "error") return `Last refresh failed: ${quota.error ?? "unknown"}`;
  return quota.fetchedAt ? `${quota.source ?? ""} · ${formatAgo(quota.fetchedAt, now)}` : undefined;
}

function MeterRow({ label, w }: { label: string; w?: QuotaWindow }) {
  const left = remainingPct(w);
  if (left === undefined) return null;
  const level = levelOf(left);
  const used = Math.max(0, Math.min(100, 100 - left));
  const reset = resetLabel(w);
  return (
    <div className="qc-row">
      <div className="qc-line">
        <span>{label}</span>
        <span className={`qc-left qc-${level}`}>
          <strong>{Math.round(left)}%</strong> left · {LEVEL_LABEL[level]}
        </span>
      </div>
      <div
        className="qc-meter"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(used)}
        aria-label={`${label} quota used`}
      >
        <div className={`qc-fill qc-fill-${level}`} style={{ width: `${used}%` }} />
      </div>
      {reset && <div className="qc-reset">Resets {reset}</div>}
    </div>
  );
}

/** Compact quota card for the side menu: both meters and the reset time. Links to /quota. */
export function QuotaIndicator() {
  const quota = useLive((s) => s.quota);
  const now = useNow(30_000);
  if (!quota || quota.status === "not_configured") {
    return (
      <Link to="/quota" className="quota-card control muted" title={NOT_CONFIGURED_HINT}>
        <span className="qc-head">
          <Icon name="quota" size={16} />
          Quota not configured
        </span>
      </Link>
    );
  }
  return (
    <Link to="/quota" className="quota-card control" title={sourceTitle(quota, now)}>
      <span className="qc-head">
        <Icon name="quota" size={16} />
        Quota
        {quota.status === "error" && <span className="chip chip-warning qc-stale">stale</span>}
      </span>
      <MeterRow label="5-hour" w={quota.fiveHour} />
      <MeterRow label="Weekly" w={quota.sevenDay} />
    </Link>
  );
}

/** One-line quota readout for the phone header: the tighter of the two windows. */
export function QuotaChip() {
  const quota = useLive((s) => s.quota);
  if (!quota || quota.status === "not_configured") {
    return (
      <Link to="/quota" className="chip quota-chip" title={NOT_CONFIGURED_HINT}>
        <Icon name="quota" size={14} />
        Not configured
      </Link>
    );
  }
  const windows = [
    { label: "5h", left: remainingPct(quota.fiveHour) },
    { label: "Week", left: remainingPct(quota.sevenDay) },
  ].filter((w): w is { label: string; left: number } => w.left !== undefined);
  if (windows.length === 0) return null;
  const tight = windows.reduce((a, b) => (b.left < a.left ? b : a));
  const level = levelOf(tight.left);
  return (
    <Link
      to="/quota"
      className={`chip quota-chip chip-${level}`}
      aria-label={`${tight.label} quota ${Math.round(tight.left)} percent left, ${LEVEL_LABEL[level]}`}
    >
      <Icon name="quota" size={14} />
      {tight.label} {Math.round(tight.left)}%{quota.status === "error" && " · stale"}
    </Link>
  );
}
