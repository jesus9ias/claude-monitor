import { PHASE_LABEL, TOOL_CATEGORY_LABEL, type Activity, type SessionStatus } from "@claude-monitor/shared";
import { formatDuration } from "../format";

export function StatusBadge({ status }: { status: SessionStatus }) {
  return (
    <span className="status">
      <span className={`dot dot-${status}`} aria-hidden="true" />
      {status}
    </span>
  );
}

/** What the session is doing now. Quiet phases render nothing unless `always` is set. */
export function ActivityBadge({ activity, now, always = false }: { activity?: Activity; now: number; always?: boolean }) {
  if (!activity) return null;
  const quiet = activity.phase === "waiting_input" || activity.phase === "ended";
  if (quiet && !always) return null;
  const elapsed = formatDuration(now - Date.parse(activity.tool?.startedAt ?? activity.since));
  return (
    <span className={`activity activity-${activity.phase}`}>
      {activity.tool ? (
        <>
          {TOOL_CATEGORY_LABEL[activity.tool.category]}: <strong>{activity.tool.name}</strong>
        </>
      ) : (
        PHASE_LABEL[activity.phase]
      )}
      {!quiet && ` · ${elapsed}`}
      {activity.agents.length > 0 && ` · ${activity.agents.length} subagent${activity.agents.length === 1 ? "" : "s"}`}
    </span>
  );
}

export function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="tile">
      <div className="tile-label">{label}</div>
      <div className="tile-value">{value}</div>
      {sub && <div className="tile-sub">{sub}</div>}
    </div>
  );
}
