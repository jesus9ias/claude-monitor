import { remainingPct, type QuotaWindow } from "@claude-monitor/shared";
import { Link } from "react-router-dom";
import { formatAgo, useNow } from "../format";
import { useLive } from "../state/live";

function Window({ label, w }: { label: string; w?: QuotaWindow }) {
  const left = remainingPct(w);
  if (left === undefined) return null;
  const level = left <= 10 ? "critical" : left <= 30 ? "warning" : "good";
  const reset = w?.resetsAt ? `Resets ${new Date(w.resetsAt).toLocaleString("en-US", { weekday: "short", hour: "2-digit", minute: "2-digit" })}` : undefined;
  return (
    <span className={`quota-window quota-${level}`} title={reset}>
      {label} <strong>{Math.round(left)}%</strong> left
    </span>
  );
}

/** Compact quota readout for the top bar. */
export function QuotaIndicator() {
  const quota = useLive((s) => s.quota);
  const now = useNow(30_000);
  if (!quota || quota.status === "not_configured") {
    return (
      <Link to="/quota" className="quota muted" title="Set CLAUDE_CODE_OAUTH_TOKEN in .env, or install the statusline feed">
        Quota not configured
      </Link>
    );
  }
  const age = quota.fetchedAt ? `${quota.source ?? ""} · ${formatAgo(quota.fetchedAt, now)}` : undefined;
  return (
    <Link to="/quota" className="quota" title={quota.status === "error" ? `Last refresh failed: ${quota.error ?? "unknown"}` : age}>
      <Window label="5h" w={quota.fiveHour} />
      <Window label="Week" w={quota.sevenDay} />
      {quota.status === "error" && <span className="quota-stale">stale</span>}
    </Link>
  );
}
