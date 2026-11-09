/**
 * Where each session is in its loop. Fed by two sources with different lag:
 *   - hooks: arrive within milliseconds, but only if they are installed;
 *   - transcript lines: always there, but written when a content block is complete.
 * Both turn into Signals. A signal older than the current phase never overrides it, so a late
 * transcript line cannot undo what a hook already said (Stop, then the final text block landing).
 */
import { classifyTool, initialActivity, WORKING_PHASES, type Activity, type Phase, type SessionStatus } from "@claude-monitor/shared";

export type SignalKind =
  | "start"
  | "prompt"
  | "request"
  | "thinking"
  | "writing"
  | "tool_start"
  | "tool_end"
  | "permission"
  | "waiting_input"
  | "stop"
  | "end"
  | "compact_start"
  | "compact_end"
  | "agent_start"
  | "agent_stop";

export interface Signal {
  kind: SignalKind;
  ts: string;
  /** "hook:PreToolUse", "transcript:thinking", ... */
  source: string;
  toolName?: string;
  toolUseId?: string;
  /** Set when the signal comes from a subagent. It then only touches that agent's state. */
  agentId?: string;
}

/** A tool with no end signal for this long lost its PostToolUse. */
export const TOOL_MAX_MS = 15 * 60_000;

export interface Track {
  phase: Phase;
  since: string;
  source: string;
  tool?: Activity["tool"];
  runningAgents: Set<string>;
  stoppedAgents: Set<string>;
  finishedTools: Set<string>;
  /** ms epoch of the last Stop, and of SessionEnd. Status uses them. */
  stoppedAt?: number;
  endedAt?: number;
}

/** What gets persisted: everything but derived sets that the transcript rebuilds. */
export interface TrackSnapshot {
  phase: Phase;
  since: string;
  source: string;
  tool?: Activity["tool"];
  runningAgents: string[];
  stoppedAgents: string[];
  stoppedAt?: number;
  endedAt?: number;
}

const PHASE_OF: Partial<Record<SignalKind, Phase>> = {
  start: "waiting_input",
  prompt: "requesting",
  request: "requesting",
  thinking: "thinking",
  writing: "writing",
  tool_start: "tool",
  tool_end: "requesting",
  permission: "waiting_permission",
  waiting_input: "waiting_input",
  stop: "waiting_input",
  end: "ended",
  compact_start: "compacting",
  compact_end: "requesting",
};

export class ActivityTracker {
  private readonly tracks = new Map<string, Track>();

  get(sessionId: string): Track | undefined {
    return this.tracks.get(sessionId);
  }

  ensure(sessionId: string, ts: string): Track {
    let t = this.tracks.get(sessionId);
    if (!t) {
      const a = initialActivity(ts);
      t = { phase: a.phase, since: a.since, source: a.source, runningAgents: new Set(), stoppedAgents: new Set(), finishedTools: new Set() };
      this.tracks.set(sessionId, t);
    }
    return t;
  }

  /** Returns true when the visible activity changed. */
  apply(sessionId: string, s: Signal): boolean {
    const t = this.ensure(sessionId, s.ts);
    const before = fingerprint(t);
    const atMs = Date.parse(s.ts);

    // Bookkeeping that holds whatever the order of arrival.
    if (s.kind === "tool_end" && s.toolUseId) t.finishedTools.add(s.toolUseId);
    if (s.kind === "agent_stop" && s.agentId) {
      t.stoppedAgents.add(s.agentId);
      t.runningAgents.delete(s.agentId);
    }
    if (s.kind === "stop") t.stoppedAt = Math.max(t.stoppedAt ?? 0, atMs);
    if (s.kind === "end") t.endedAt = Math.max(t.endedAt ?? 0, atMs);
    if (s.kind === "prompt" || s.kind === "start" || s.kind === "tool_start") {
      if (!s.agentId && t.stoppedAt !== undefined && atMs >= t.stoppedAt) t.stoppedAt = undefined;
      if (!s.agentId && t.endedAt !== undefined && atMs >= t.endedAt) t.endedAt = undefined;
    }

    if (s.agentId) {
      // A subagent's work keeps it marked as running; the main loop's phase is the Agent tool call.
      if (s.kind !== "agent_stop" && !t.stoppedAgents.has(s.agentId)) t.runningAgents.add(s.agentId);
      return fingerprint(t) !== before;
    }

    if (s.ts < t.since) return fingerprint(t) !== before;
    const phase = PHASE_OF[s.kind];
    if (phase === undefined) return fingerprint(t) !== before;

    if (s.kind === "tool_start") {
      // Hooks run async, so a fast tool's Post can overtake its Pre.
      if (s.toolUseId && t.finishedTools.has(s.toolUseId)) return fingerprint(t) !== before;
      const sameTool = t.phase === "tool" && t.tool && s.toolUseId && t.tool.toolUseId === s.toolUseId;
      t.tool = { ...classifyTool(s.toolName ?? "unknown"), toolUseId: s.toolUseId, startedAt: sameTool ? t.tool!.startedAt : s.ts };
    } else if (s.kind === "tool_end") {
      // Parallel calls: the end of one call does not end another that is still running.
      if (t.phase === "tool" && t.tool?.toolUseId && s.toolUseId && t.tool.toolUseId !== s.toolUseId) {
        return fingerprint(t) !== before;
      }
      t.tool = undefined;
    } else {
      t.tool = undefined;
    }
    if (s.kind === "stop" || s.kind === "end") t.runningAgents.clear();

    if (t.phase !== phase || s.kind === "tool_start") {
      if (t.phase !== phase) t.since = s.ts;
      t.phase = phase;
    }
    t.source = s.source;
    return fingerprint(t) !== before;
  }

  /** Drops a tool whose end never came. Returns true when something changed. */
  expire(sessionId: string, now: number): boolean {
    const t = this.tracks.get(sessionId);
    if (!t?.tool || now - Date.parse(t.tool.startedAt) < TOOL_MAX_MS) return false;
    t.tool = undefined;
    t.phase = "waiting_input";
    t.since = new Date(now).toISOString();
    t.source = "expired";
    return true;
  }

  /**
   * The activity shown to people. A working phase is only believable while the session is active:
   * once it goes quiet, Claude is waiting (or the session ended), whatever the last signal said.
   */
  view(sessionId: string, status: SessionStatus, lastEventAt: string): Activity {
    const t = this.tracks.get(sessionId);
    if (!t) return { ...initialActivity(lastEventAt), phase: status === "ended" ? "ended" : "waiting_input" };
    const agents = status === "active" ? [...t.runningAgents] : [];
    if (status === "ended") return { phase: "ended", since: t.endedAt ? new Date(t.endedAt).toISOString() : lastEventAt, agents: [], source: t.source };
    if (status === "idle" && WORKING_PHASES.has(t.phase)) {
      return { phase: "waiting_input", since: lastEventAt, agents: [], source: "quiet" };
    }
    return { phase: t.phase, since: t.since, tool: t.tool, agents, source: t.source };
  }

  snapshot(sessionId: string): TrackSnapshot | undefined {
    const t = this.tracks.get(sessionId);
    if (!t) return undefined;
    return {
      phase: t.phase,
      since: t.since,
      source: t.source,
      tool: t.tool,
      runningAgents: [...t.runningAgents],
      stoppedAgents: [...t.stoppedAgents],
      stoppedAt: t.stoppedAt,
      endedAt: t.endedAt,
    };
  }

  restore(sessionId: string, snap: TrackSnapshot): void {
    this.tracks.set(sessionId, {
      phase: snap.phase,
      since: snap.since,
      source: snap.source,
      tool: snap.tool,
      runningAgents: new Set(snap.runningAgents),
      stoppedAgents: new Set(snap.stoppedAgents),
      finishedTools: new Set(),
      stoppedAt: snap.stoppedAt,
      endedAt: snap.endedAt,
    });
  }
}

const fingerprint = (t: Track): string =>
  `${t.phase}|${t.since}|${t.tool?.toolUseId ?? ""}|${t.tool?.name ?? ""}|${[...t.runningAgents].join(",")}`;
