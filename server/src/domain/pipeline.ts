/**
 * Aggregates for the pipeline view: what each block of the loop has done in this session. Built from
 * the session's events and messages; format-neutral (no transcript knowledge here).
 */
import { readFileSync } from "node:fs";
import {
  classifyTool,
  emptyUsage,
  isAgentTool,
  PIPELINE_RECENT,
  TOOL_CATEGORIES,
  type CategoryStats,
  type Event,
  type NodeStatus,
  type PipelineAgent,
  type PipelineCall,
  type PipelineStats,
  type ReplayStep,
  type ToolCategory,
} from "@claude-monitor/shared";
import { addUsage, type SessionState } from "./sessions.js";

interface ContextTable {
  default: number;
  extended: number;
  models: Record<string, number>;
}

const CONTEXT: ContextTable = JSON.parse(readFileSync(new URL("./models.json", import.meta.url), "utf8")) as ContextTable;
const MAX_REPLAY_STEPS = 300;

export function contextWindow(model: string | undefined, observedTokens: number): number {
  const base = (model && (CONTEXT.models[model] ?? CONTEXT.models[model.replace(/-\d{8}$/, "")])) || CONTEXT.default;
  return observedTokens > base ? Math.max(CONTEXT.extended, observedTokens) : base;
}

const emptyCategory = (): CategoryStats => ({ calls: 0, errors: 0, totalDurationMs: 0, finished: 0, recent: [], byTool: {} });

/**
 * `running` holds the agent ids the activity tracker says are running; `now` decides whether an
 * unanswered tool is still running (only while the session is active).
 */
export function buildPipeline(state: SessionState, events: Event[], running: ReadonlySet<string>): PipelineStats {
  const { session } = state;
  const results = new Map<string, Event>();
  for (const e of events) if (e.kind === "tool_result" && e.toolUseId) results.set(e.toolUseId, e);

  const categories = Object.fromEntries(TOOL_CATEGORIES.map((c) => [c, emptyCategory()])) as Record<ToolCategory, CategoryStats>;
  const mcpServers: PipelineStats["mcpServers"] = {};
  const calls: { category: ToolCategory; call: PipelineCall }[] = [];
  let prompts = 0;
  let thinkingBlocks = 0;
  let textBlocks = 0;
  let permissionPrompts = 0;
  const agentStats = new Map<string, { tokens: number; toolCalls: number; model?: string }>();
  const agentOf = (id: string) => {
    let a = agentStats.get(id);
    if (!a) agentStats.set(id, (a = { tokens: 0, toolCalls: 0 }));
    return a;
  };

  for (const e of events) {
    if (e.agentId && e.usage) {
      const a = agentOf(e.agentId);
      a.tokens += e.usage.input + e.usage.output;
      if (e.model) a.model = e.model;
    }
    switch (e.kind) {
      case "user":
        if (!e.agentId) prompts++;
        break;
      case "thinking":
        if (!e.agentId) thinkingBlocks++;
        break;
      case "assistant":
        if (!e.agentId) textBlocks++;
        break;
      case "hook":
        if (/^(PermissionRequest|Elicitation)\b|^Notification: (permission_prompt|elicitation_dialog)/.test(e.summary)) permissionPrompts++;
        break;
      case "tool_use": {
        const ref = classifyTool(e.toolName ?? "unknown");
        const result = e.toolUseId ? results.get(e.toolUseId) : undefined;
        const status: NodeStatus | undefined = result ? (result.isError ? "error" : "ok") : session.status === "active" ? "running" : undefined;
        const durationMs = result ? Math.max(0, Date.parse(result.ts) - Date.parse(e.ts)) : undefined;
        const cat = categories[ref.category];
        cat.calls++;
        if (status === "error") cat.errors++;
        if (durationMs !== undefined) {
          cat.totalDurationMs += durationMs;
          cat.finished++;
          cat.lastDurationMs = durationMs;
        }
        cat.byTool[ref.name] = (cat.byTool[ref.name] ?? 0) + 1;
        if (ref.mcpServer) {
          const srv = (mcpServers[ref.mcpServer] ??= { calls: 0, errors: 0 });
          srv.calls++;
          if (status === "error") srv.errors++;
        }
        if (e.agentId) agentOf(e.agentId).toolCalls++;
        calls.push({
          category: ref.category,
          call: { toolUseId: e.toolUseId, name: ref.name, mcpServer: ref.mcpServer, summary: e.summary, status, startedAt: e.ts, durationMs, agentId: e.agentId },
        });
        break;
      }
      default:
        break;
    }
  }
  for (let i = calls.length - 1; i >= 0; i--) {
    const { category, call } = calls[i]!;
    const list = categories[category].recent;
    if (list.length < PIPELINE_RECENT) list.push(call);
  }

  // Agent tool calls that started each subagent, for their status.
  const agentCall = new Map<string, Event>();
  for (const e of events) {
    if (e.kind !== "tool_use" || !isAgentTool(e.toolName) || !e.toolUseId) continue;
    for (const [agentId, meta] of state.agents) if (meta.toolUseId === e.toolUseId) agentCall.set(agentId, e);
  }
  const agents: PipelineAgent[] = [...state.agents.entries()].map(([agentId, meta]) => {
    const stats = agentStats.get(agentId);
    const use = agentCall.get(agentId);
    const result = use?.toolUseId ? results.get(use.toolUseId) : undefined;
    return {
      agentId,
      type: meta.agentType,
      description: meta.description,
      model: stats?.model,
      tokens: stats?.tokens ?? 0,
      toolCalls: stats?.toolCalls ?? 0,
      status: running.has(agentId) ? "running" : result?.isError ? "error" : "ok",
    };
  });

  // Model: main-conversation messages only; the context is the latest one's prompt size.
  const usage = emptyUsage();
  let messages = 0;
  let latest: { ts: string; tokens: number } | undefined;
  for (const m of state.messages.values()) {
    if (m.event?.agentId) continue;
    messages++;
    addUsage(usage, m.usage);
    const tokens = m.usage.input + m.usage.cacheRead + m.usage.cacheCreate;
    if (!latest || m.ts >= latest.ts) latest = { ts: m.ts, tokens };
  }
  const contextTokens = latest?.tokens ?? 0;

  return {
    prompts,
    model: { name: session.model, messages, thinkingBlocks, textBlocks, usage },
    context: { tokens: contextTokens, windowTokens: contextWindow(session.model, contextTokens), compactions: state.compactions.size },
    categories,
    mcpServers,
    agents,
    permissionPrompts,
    lastTurn: replaySteps(events),
  };
}

/** The phases of the last main-conversation turn, in the order the transcript recorded them. */
export function replaySteps(events: Event[]): ReplayStep[] {
  let start = -1;
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.kind === "user" && !e.agentId) {
      start = i;
      break;
    }
  }
  if (start === -1) return [];
  const steps: ReplayStep[] = [];
  const push = (step: ReplayStep): void => {
    const last = steps[steps.length - 1];
    if (last && last.phase === step.phase && !step.tool) return;
    steps.push(step);
  };
  for (const e of events.slice(start)) {
    if (e.agentId) continue;
    switch (e.kind) {
      case "user":
        push({ ts: e.ts, phase: "requesting" });
        break;
      case "thinking":
        push({ ts: e.ts, phase: "thinking" });
        break;
      case "assistant":
        push({ ts: e.ts, phase: "writing" });
        break;
      case "tool_use": {
        const { name, category, mcpServer } = classifyTool(e.toolName ?? "unknown");
        push({ ts: e.ts, phase: "tool", tool: { name, category, mcpServer, toolUseId: e.toolUseId } });
        break;
      }
      case "tool_result":
        push({ ts: e.ts, phase: "requesting" });
        break;
      default:
        break;
    }
  }
  const last = steps[steps.length - 1];
  if (last) steps.push({ ts: last.ts, phase: "waiting_input" });
  return steps.slice(-MAX_REPLAY_STEPS);
}
