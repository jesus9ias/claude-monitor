/**
 * Joins sessions (from transcripts), activity (from hooks and transcripts) and status, and emits a
 * domain event whenever what a viewer would see changes. Ingest code calls in; nothing here reads
 * files or speaks HTTP.
 */
import type { Activity, Event, ProcessInfo, Session } from "@claude-monitor/shared";
import type { Bus } from "../bus.js";
import type { HookUpdate } from "../ingest/hooks.js";
import type { ParsedLine, SubagentMeta } from "../ingest/transcript.js";
import { ActivityTracker, type Signal } from "./activity.js";
import type { PriceTable } from "./pricing.js";
import { SessionStore, type SessionState } from "./sessions.js";
import { computeStatus } from "./status.js";

export class Monitor {
  readonly sessions: SessionStore;
  readonly activity = new ActivityTracker();
  /** While true (the boot scan), state is built but nothing is emitted. */
  quiet = false;
  private readonly shown = new Map<string, string>();

  constructor(
    prices: PriceTable,
    private readonly bus: Bus,
  ) {
    this.sessions = new SessionStore(prices);
  }

  ingestLines(lines: ParsedLine[], now: number = Date.now()): void {
    const touched = new Map<SessionState, Event[]>();
    for (const line of lines) {
      const result = this.sessions.ingest(line);
      if (!result) continue;
      for (const signal of transcriptSignals(line, result.added)) this.activity.apply(result.state.session.id, signal);
      touched.set(result.state, [...(touched.get(result.state) ?? []), ...result.added]);
    }
    for (const [state, added] of touched) this.publish(state, added, now, true);
  }

  agentMeta(sessionId: string, agentId: string): SubagentMeta | undefined {
    return this.sessions.get(sessionId)?.agents.get(agentId);
  }

  linkAgent(sessionId: string, agentId: string, meta: SubagentMeta, ts: string): void {
    this.sessions.linkAgent(this.sessions.ensure(sessionId, ts), agentId, meta);
  }

  applyHook(hook: HookUpdate, now: number = Date.now()): void {
    const state = this.sessions.ensure(hook.sessionId, hook.ts);
    this.sessions.touch(state, hook.ts);
    if (hook.cwd && !state.session.cwd) state.session.cwd = hook.cwd;
    for (const signal of hook.signals) this.activity.apply(hook.sessionId, signal);
    this.publish(state, this.sessions.addEvents(state, hook.events), now, true);
  }

  applyProcesses(processes: ProcessInfo[], now: number = Date.now()): void {
    const pidBySession = new Map<string, number>();
    for (const p of processes) if (p.sessionId) pidBySession.set(p.sessionId, p.pid);
    for (const state of this.sessions.states.values()) {
      const pid = pidBySession.get(state.session.id);
      const changed = pid !== state.session.pid;
      state.session.pid = pid;
      this.publish(state, [], now, changed);
    }
    if (!this.quiet) this.bus.emit({ type: "processes_changed", processes });
  }

  /** Re-evaluates every session against the clock: lost tools expire, quiet sessions go idle. */
  tick(now: number = Date.now()): void {
    for (const state of this.sessions.states.values()) {
      this.activity.expire(state.session.id, now);
      this.publish(state, [], now, false);
    }
  }

  isAnyActive(): boolean {
    return this.sessions.listSessions().some((s) => s.status === "active");
  }

  /** Recomputes status and activity, and emits what changed. */
  private publish(state: SessionState, added: Event[], now: number, dataChanged: boolean): void {
    const { session } = state;
    const status = computeStatus(session, this.activity.get(session.id), now);
    const activity: Activity = this.activity.view(session.id, status, session.lastEventAt);
    const key = activityKey(activity);
    const activityChanged = this.shown.get(session.id) !== key;
    const statusChanged = status !== session.status;
    session.status = status;
    session.activity = activity;
    this.shown.set(session.id, key);

    if (this.quiet || !session.cwd) return;
    if (added.length) this.bus.emit({ type: "events_added", sessionId: session.id, events: added });
    if (activityChanged) this.bus.emit({ type: "activity_changed", sessionId: session.id, activity });
    if (dataChanged || statusChanged || activityChanged || added.length) this.bus.emit({ type: "session_changed", session: snapshot(session) });
  }
}

const activityKey = (a: Activity): string => `${a.phase}|${a.since}|${a.tool?.toolUseId ?? a.tool?.name ?? ""}|${a.agents.join(",")}`;

/** Consumers may hold on to what they receive; the live object keeps changing. */
const snapshot = (s: Session): Session => ({ ...s, usage: { ...s.usage }, activity: { ...s.activity } });

/** Transcript content, turned into activity. Format-neutral: it reads Events and markers, not JSON. */
export function transcriptSignals(line: ParsedLine, added: Event[]): Signal[] {
  const out: Signal[] = [];
  const ts = line.ts;
  if (line.marker && ts) {
    const kind =
      line.marker.kind === "request" ? "request" : line.marker.kind === "turn_end" ? "stop" : line.marker.kind === "compacted" ? "compact_end" : undefined;
    if (kind) out.push({ kind, ts, source: `transcript:${line.marker.kind}`, agentId: line.agentId });
  }
  for (const e of added) {
    const base = { ts: e.ts, agentId: e.agentId };
    switch (e.kind) {
      case "user":
        out.push({ ...base, kind: "prompt", source: "transcript:prompt" });
        break;
      case "thinking":
        out.push({ ...base, kind: "thinking", source: "transcript:thinking" });
        break;
      case "assistant":
        out.push({ ...base, kind: "writing", source: "transcript:text" });
        break;
      case "tool_use":
        out.push({ ...base, kind: "tool_start", source: "transcript:tool_use", toolName: e.toolName, toolUseId: e.toolUseId });
        break;
      case "tool_result":
        out.push({ ...base, kind: "tool_end", source: "transcript:tool_result", toolUseId: e.toolUseId });
        break;
      case "subagent_start":
        out.push({ ...base, kind: "agent_start", source: "transcript:subagent" });
        break;
      default:
        break;
    }
  }
  return out;
}
