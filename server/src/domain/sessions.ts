/**
 * Sessions, their events and their token usage, built from transcript lines. Knows nothing about
 * hooks, status or activity: those live in activity.ts and status.ts, and monitor.ts joins them.
 */
import { emptyUsage, initialActivity, type Event, type Session, type Usage, type UsagePoint } from "@claude-monitor/shared";
import type { ParsedLine, ParsedMessage, SubagentMeta } from "../ingest/transcript.js";
import { messageCost, type PriceTable } from "./pricing.js";

export interface MessageRecord extends ParsedMessage {
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
  /** Timestamps of main-conversation compactions. A set, so re-reading a file counts nothing twice. */
  compactions: Set<string>;
}

export function addUsage(into: Usage, u: Usage, sign: 1 | -1 = 1): void {
  into.input += sign * u.input;
  into.output += sign * u.output;
  into.cacheRead += sign * u.cacheRead;
  into.cacheCreate += sign * u.cacheCreate;
  into.cacheCreate1h += sign * u.cacheCreate1h;
}

export class SessionStore {
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
          activity: initialActivity(ts),
        },
        events: [],
        eventIds: new Set(),
        sorted: true,
        messages: new Map(),
        toolNames: new Map(),
        agents: new Map(),
        compactions: new Set(),
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
      this.touch(state, line.ts);
      if (line.ts >= session.lastEventAt) {
        if (line.cwd) session.cwd = line.cwd;
        if (line.gitBranch) session.gitBranch = line.gitBranch;
      }
      if (!session.cwd && line.cwd) session.cwd = line.cwd;
    }
    if (line.entrypoint && !line.agentId) session.entrypoint = line.entrypoint;
    if (line.title && (line.title.source === "custom" || state.titleSource !== "custom")) {
      session.title = line.title.text;
      state.titleSource = line.title.source;
    }
    if (line.marker?.kind === "compacted" && line.ts && !line.agentId) state.compactions.add(line.ts);
    if (line.reportedCostUsd !== undefined) state.reportedCostUsd = line.reportedCostUsd;
    if (line.subagentLink) this.linkAgent(state, line.subagentLink.agentId, { toolUseId: line.subagentLink.toolUseId });

    const added = this.addEvents(state, line.events);
    if (line.message) this.applyMessage(state, line.message, line.events[0]);
    return { state, added };
  }

  /** Moves lastEventAt forward. Hooks and transcript lines both count as activity. */
  touch(state: SessionState, ts: string): void {
    if (ts > state.session.lastEventAt) state.session.lastEventAt = ts;
  }

  addEvents(state: SessionState, events: Event[]): Event[] {
    const added: Event[] = [];
    for (const event of events) {
      if (state.eventIds.has(event.id)) continue;
      state.eventIds.add(event.id);
      if (event.toolName && event.toolUseId && event.kind === "tool_use") state.toolNames.set(event.toolUseId, event.toolName);
      if (event.kind === "tool_result" && event.toolUseId) event.toolName = state.toolNames.get(event.toolUseId);
      const last = state.events[state.events.length - 1];
      if (last && event.ts < last.ts) state.sorted = false;
      state.events.push(event);
      added.push(event);
    }
    return added;
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

  usageSeries(state: SessionState): UsagePoint[] {
    return [...state.messages.values()]
      .sort((a, b) => a.ts.localeCompare(b.ts))
      .map((m) => ({ ts: m.ts, usage: m.usage }));
  }
}
