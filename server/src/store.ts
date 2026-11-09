import {
  emptyUsage,
  type Event,
  type ProcessInfo,
  type Session,
  type SessionStatus,
  type Stats,
  type StatsRange,
  type StatsRow,
  type Usage,
  type UsagePoint,
} from "@claude-monitor/shared";
import type { ParsedLine, ParsedMessage, SubagentMeta } from "./parser/jsonl.js";
import { messageCost, type PriceTable } from "./pricing.js";

const ACTIVE_MS = 30_000;
const IDLE_MS = 15 * 60_000;
const STOP_GRACE_MS = 2_000;
const CURRENT_TOOL_MAX_MS = 15 * 60_000;

const localDay = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

interface MessageRecord extends ParsedMessage {
  costUsd: number | null;
  event?: Event;
}

export interface SessionState {
  session: Session;
  events: Event[];
  eventIds: Set<string>;
  sorted: boolean;
  messages: Map<string, MessageRecord>;
  toolNames: Map<string, string>;
  titleSource?: "custom" | "ai";
  agents: Map<string, SubagentMeta>;
  reportedCostUsd?: number;
  modelTs?: string;
  finishedTools: Set<string>;
  stoppedAgents: Set<string>;
  stoppedAt?: number;
  endedAt?: number;
}

export type HookEffect = "started" | "prompt" | "tool_start" | "tool_end" | "stopped" | "ended" | "subagent_stopped" | "none";

export interface HookUpdate {
  sessionId: string;
  ts: string;
  cwd?: string;
  effect: HookEffect;
  toolName?: string;
  toolUseId?: string;
  agentId?: string;
  events: Event[];
}

export function addUsage(into: Usage, u: Usage, sign: 1 | -1 = 1): void {
  into.input += sign * u.input;
  into.output += sign * u.output;
  into.cacheRead += sign * u.cacheRead;
  into.cacheCreate += sign * u.cacheCreate;
  into.cacheCreate1h += sign * u.cacheCreate1h;
}

export class Store {
  readonly states = new Map<string, SessionState>();

  constructor(private readonly prices: PriceTable) {}

  /** Sessions with no conversation yet (only a title line, say) have no cwd and stay hidden. */
  listSessions(): Session[] {
    return [...this.states.values()]
      .map((s) => s.session)
      .filter((s) => s.cwd)
      .sort((a, b) => b.lastEventAt.localeCompare(a.lastEventAt));
  }

  get(sessionId: string): SessionState | undefined {
    return this.states.get(sessionId);
  }

  ensure(sessionId: string, ts: string): SessionState {
    let state = this.states.get(sessionId);
    if (!state) {
      state = {
        session: {
          id: sessionId,
          cwd: "",
          status: "ended",
          startedAt: ts,
          lastEventAt: ts,
          usage: emptyUsage(),
          costUsd: 0,
          usageByModel: {},
          subagents: [],
        },
        events: [],
        eventIds: new Set(),
        sorted: true,
        messages: new Map(),
        toolNames: new Map(),
        agents: new Map(),
        finishedTools: new Set(),
        stoppedAgents: new Set(),
      };
      this.states.set(sessionId, state);
    }
    return state;
  }

  /** Idempotent: re-ingesting a line changes nothing. Returns the newly added events. */
  ingest(line: ParsedLine): { state: SessionState; added: Event[] } | null {
    if (!line.sessionId) return null;
    const state = this.ensure(line.sessionId, line.ts ?? new Date().toISOString());
    const { session } = state;

    if (line.ts) {
      if (line.ts < session.startedAt) session.startedAt = line.ts;
      if (line.ts >= session.lastEventAt) {
        session.lastEventAt = line.ts;
        if (line.cwd) session.cwd = line.cwd;
        if (line.gitBranch) session.gitBranch = line.gitBranch;
      }
      if (!session.cwd && line.cwd) session.cwd = line.cwd;
    }
    if (line.title && (line.title.source === "custom" || state.titleSource !== "custom")) {
      session.title = line.title.text;
      state.titleSource = line.title.source;
    }
    if (line.reportedCostUsd !== undefined) state.reportedCostUsd = line.reportedCostUsd;
    if (line.subagentLink) this.linkAgent(state, line.subagentLink.agentId, { toolUseId: line.subagentLink.toolUseId });

    const added: Event[] = [];
    for (const event of line.events) {
      if (state.eventIds.has(event.id)) continue;
      state.eventIds.add(event.id);
      if (event.toolName && event.toolUseId) state.toolNames.set(event.toolUseId, event.toolName);
      if (event.kind === "tool_result" && event.toolUseId) {
        event.toolName = state.toolNames.get(event.toolUseId);
        // Clears a running tool whose PostToolUse hook was lost.
        state.finishedTools.add(event.toolUseId);
        if (state.session.current?.toolUseId === event.toolUseId) state.session.current = undefined;
      }
      const last = state.events[state.events.length - 1];
      if (last && event.ts < last.ts) state.sorted = false;
      state.events.push(event);
      added.push(event);
    }
    if (line.message) this.applyMessage(state, line.message, line.events[0]);
    return { state, added };
  }

  linkAgent(state: SessionState, agentId: string, meta: SubagentMeta): void {
    if (!state.session.subagents.includes(agentId)) state.session.subagents.push(agentId);
    state.agents.set(agentId, { ...state.agents.get(agentId), ...meta });
  }

  /** A message spans several lines: counted once, using the latest usage reported for it. */
  private applyMessage(state: SessionState, message: ParsedMessage, firstEvent?: Event): void {
    const { session } = state;
    const previous = state.messages.get(message.id);
    const costUsd = messageCost(this.prices, message.model, message.usage, message.speed);
    const record: MessageRecord = { ...message, costUsd, ts: previous?.ts ?? message.ts, event: previous?.event ?? firstEvent };

    const byModel = (session.usageByModel[message.model] ??= emptyUsage());
    if (previous) {
      addUsage(session.usage, previous.usage, -1);
      addUsage(byModel, previous.usage, -1);
    }
    addUsage(session.usage, message.usage);
    addUsage(byModel, message.usage);
    state.messages.set(message.id, record);
    if (record.event) {
      record.event.usage = message.usage;
      record.event.model = message.model;
    }

    let cost: number | null = 0;
    for (const m of state.messages.values()) {
      if (m.costUsd === null) {
        cost = null;
        break;
      }
      cost += m.costUsd;
    }
    session.costUsd = cost;

    // The session's model is what the main conversation last used, not its subagents.
    if (!firstEvent?.agentId && (!state.modelTs || message.ts >= state.modelTs)) {
      session.model = message.model;
      state.modelTs = message.ts;
    }
  }

  sortedEvents(state: SessionState): Event[] {
    if (!state.sorted) {
      state.events.sort((a, b) => a.ts.localeCompare(b.ts));
      state.sorted = true;
    }
    return state.events;
  }

  sessionForCwd(cwd: string): string | undefined {
    return this.listSessions().find((s) => s.cwd === cwd)?.id;
  }

  /** Links live processes to sessions. Returns the sessions whose pid changed. */
  applyProcesses(processes: ProcessInfo[]): Session[] {
    const pidBySession = new Map<string, number>();
    for (const p of processes) if (p.sessionId) pidBySession.set(p.sessionId, p.pid);

    const changed: Session[] = [];
    for (const { session } of this.states.values()) {
      const pid = pidBySession.get(session.id);
      if (pid !== session.pid) {
        session.pid = pid;
        if (session.cwd) changed.push(session);
      }
    }
    return changed;
  }

  /** Recomputes every status. Returns the sessions whose status changed. */
  refreshStatuses(now: number = Date.now()): Session[] {
    const changed: Session[] = [];
    for (const state of this.states.values()) {
      const status = this.computeStatus(state, now);
      if (status !== state.session.status) {
        state.session.status = status;
        if (state.session.cwd) changed.push(state.session);
      }
    }
    return changed;
  }

  /**
   * Hooks say what is happening; the age heuristic covers sessions that started before the hooks
   * were installed, or while this server was down.
   */
  private computeStatus(state: SessionState, now: number): SessionStatus {
    const { session } = state;
    const lastEvent = Date.parse(session.lastEventAt);
    const age = now - lastEvent;

    if (session.current) {
      if (now - Date.parse(session.current.startedAt) < CURRENT_TOOL_MAX_MS) return "active";
      session.current = undefined; // Its PostToolUse never reached us.
    }
    // Trailing transcript lines can land just after Stop or SessionEnd and must not undo them.
    const settled = (at: number | undefined): boolean => at !== undefined && lastEvent <= at + STOP_GRACE_MS;
    if (settled(state.endedAt)) return "ended";
    if (session.pid === undefined && age >= IDLE_MS) return "ended";
    if (settled(state.stoppedAt)) return "idle";
    if (age < ACTIVE_MS) return "active";
    return "idle";
  }

  /** Applies a Claude Code hook. All knowledge of the hook payload lives in hooks.ts. */
  applyHook(hook: HookUpdate): { state: SessionState; added: Event[] } {
    const state = this.ensure(hook.sessionId, hook.ts);
    const { session } = state;
    if (hook.ts > session.lastEventAt) session.lastEventAt = hook.ts;
    if (hook.cwd && !session.cwd) session.cwd = hook.cwd;
    const atMs = Date.parse(hook.ts);

    switch (hook.effect) {
      case "started":
      case "prompt":
        state.stoppedAt = undefined;
        state.endedAt = undefined;
        break;
      case "tool_start":
        state.stoppedAt = undefined;
        state.endedAt = undefined;
        // Hooks run async, so a fast tool's Post can overtake its Pre.
        if (!hook.toolUseId || !state.finishedTools.has(hook.toolUseId)) {
          session.current = { toolName: hook.toolName ?? "unknown", toolUseId: hook.toolUseId, startedAt: hook.ts };
        }
        break;
      case "tool_end":
        if (hook.toolUseId) state.finishedTools.add(hook.toolUseId);
        if (!session.current?.toolUseId || session.current.toolUseId === hook.toolUseId) session.current = undefined;
        break;
      case "stopped":
        state.stoppedAt = atMs;
        session.current = undefined;
        break;
      case "ended":
        state.endedAt = atMs;
        session.current = undefined;
        break;
      case "subagent_stopped":
        if (hook.agentId) state.stoppedAgents.add(hook.agentId);
        break;
      case "none":
        break;
    }

    const added: Event[] = [];
    for (const event of hook.events) {
      if (state.eventIds.has(event.id)) continue;
      state.eventIds.add(event.id);
      const last = state.events[state.events.length - 1];
      if (last && event.ts < last.ts) state.sorted = false;
      state.events.push(event);
      added.push(event);
    }
    return { state, added };
  }

  stats(range: StatsRange, now: Date = new Date()): Stats {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    start.setDate(start.getDate() - (range === "today" ? 0 : range === "7d" ? 6 : 29));
    const startMs = start.getTime();

    const rows = new Map<string, StatsRow>();
    for (const state of this.states.values()) {
      for (const m of state.messages.values()) {
        const at = new Date(m.ts);
        if (at.getTime() < startMs) continue;
        const day = localDay(at);
        const key = `${day}|${m.model}`;
        let row = rows.get(key);
        if (!row) {
          row = { day, model: m.model, usage: emptyUsage(), costUsd: 0 };
          rows.set(key, row);
        }
        addUsage(row.usage, m.usage);
        row.costUsd = row.costUsd === null || m.costUsd === null ? null : row.costUsd + m.costUsd;
      }
    }
    return {
      range,
      rows: [...rows.values()].sort((a, b) => a.day.localeCompare(b.day) || a.model.localeCompare(b.model)),
    };
  }

  usageSeries(state: SessionState): UsagePoint[] {
    return [...state.messages.values()]
      .sort((a, b) => a.ts.localeCompare(b.ts))
      .map((m) => ({ ts: m.ts, usage: m.usage }));
  }
}
