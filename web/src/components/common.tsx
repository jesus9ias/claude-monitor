import type { CurrentActivity, SessionStatus } from "@claude-monitor/shared";
import { formatDuration } from "../format";

export function StatusBadge({ status }: { status: SessionStatus }) {
  return (
    <span className="status">
      <span className={`dot dot-${status}`} aria-hidden="true" />
      {status}
    </span>
  );
}

export function CurrentTool({ current, now }: { current?: CurrentActivity; now: number }) {
  if (!current) return null;
  return (
    <span className="current-tool">
      Running <strong>{current.toolName}</strong> · {formatDuration(now - Date.parse(current.startedAt))}
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
