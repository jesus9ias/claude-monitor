import type { Session, SessionStatus } from "@claude-monitor/shared";
import type { Track } from "./activity.js";

export const ACTIVE_MS = 30_000;
export const IDLE_MS = 15 * 60_000;
/** Trailing transcript lines can land just after Stop or SessionEnd and must not undo them. */
const STOP_GRACE_MS = 2_000;

/**
 * Hooks say what is happening; the age rule covers sessions with no hooks (started before they were
 * installed, or while this server was down).
 */
export function computeStatus(session: Session, track: Track | undefined, now: number): SessionStatus {
  const lastEvent = Date.parse(session.lastEventAt);
  const age = now - lastEvent;

  // Expiry of a lost tool is the tracker's job, so a tool here is a tool that is really running.
  if (track?.tool) return "active";
  // Blocked on the person: not working, whatever the age rule says.
  if (track?.phase === "waiting_permission" && track.endedAt === undefined) return "idle";

  const settled = (at: number | undefined): boolean => at !== undefined && lastEvent <= at + STOP_GRACE_MS;
  if (settled(track?.endedAt)) return "ended";
  if (session.pid === undefined && age >= IDLE_MS) return "ended";
  if (settled(track?.stoppedAt)) return "idle";
  if (age < ACTIVE_MS) return "active";
  return "idle";
}
