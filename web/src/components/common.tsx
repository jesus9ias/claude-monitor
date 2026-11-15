import { PHASE_LABEL, TOOL_CATEGORY_LABEL, type Activity, type Phase, type SessionStatus } from "@claude-monitor/shared";
import { formatDuration } from "../format";
import { CATEGORY_ICON, Icon, type IconName } from "./Icon";

const STATUS_LABEL: Record<SessionStatus, string> = { active: "Active", idle: "Idle", ended: "Ended" };

/** Status as shape + word + color: pulsing dot, ring, hollow dot, or a triangle for an error. */
export function StatusBadge({ status, error = false }: { status: SessionStatus; error?: boolean }) {
  if (error) {
    return (
      <span className="status status-error">
        <Icon name="warning" size={14} />
        Error
      </span>
    );
  }
  return (
    <span className={`status status-${status}`}>
      <span className={`dot dot-${status}`} aria-hidden="true" />
      {STATUS_LABEL[status]}
    </span>
  );
}

const PHASE_ICON: Record<Phase, IconName> = {
  waiting_input: "you",
  requesting: "model",
  thinking: "model",
  writing: "output",
  tool: "other",
  waiting_permission: "input",
  compacting: "context",
  ended: "ok",
};

/** What the session is doing now, with the tool-category icon. Quiet phases render nothing unless `always` is set. */
export function ActivityBadge({ activity, now, always = false }: { activity?: Activity; now: number; always?: boolean }) {
  if (!activity) return null;
  const quiet = activity.phase === "waiting_input" || activity.phase === "ended";
  if (quiet && !always) return null;
  const elapsed = formatDuration(now - Date.parse(activity.tool?.startedAt ?? activity.since));
  const icon = activity.tool ? CATEGORY_ICON[activity.tool.category] : PHASE_ICON[activity.phase];
  return (
    <span className={`activity activity-${activity.phase}`}>
      <Icon name={icon} size={14} />
      <span>
        {activity.tool ? (
          <>
            {TOOL_CATEGORY_LABEL[activity.tool.category]}: <strong>{activity.tool.name}</strong>
          </>
        ) : (
          PHASE_LABEL[activity.phase]
        )}
        {!quiet && <span className="faint"> · {elapsed}</span>}
        {activity.agents.length > 0 && (
          <span className="faint">
            {" "}
            · {activity.agents.length} subagent{activity.agents.length === 1 ? "" : "s"}
          </span>
        )}
      </span>
    </span>
  );
}

export function Tile({ label, value, sub, icon }: { label: string; value: string; sub?: string; icon?: IconName }) {
  return (
    <div className="tile">
      <div className="tile-label">
        {icon && <Icon name={icon} size={16} />}
        {label}
      </div>
      <div className="tile-value">{value}</div>
      {sub && <div className="tile-sub">{sub}</div>}
    </div>
  );
}

/** Empty state: icon, a line, an optional hint. */
export function EmptyState({ icon = "calendar", title, hint }: { icon?: IconName; title: string; hint?: string }) {
  return (
    <div className="state">
      <span className="state-icon">
        <Icon name={icon} size={22} />
      </span>
      <strong>{title}</strong>
      {hint && <span className="small">{hint}</span>}
    </div>
  );
}

/** Error state: triangle, a title and what happens next. */
export function ErrorState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="alert" role="alert">
      <Icon name="warning" />
      <div>
        <strong>{title}</strong>
        {hint && <div className="small">{hint}</div>}
      </div>
    </div>
  );
}
