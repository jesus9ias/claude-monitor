import type { Event, Graph, GraphEdge, GraphItem, GraphNode, NodeStatus } from "@claude-monitor/shared";
import type { SessionState } from "./sessions.js";

/** A container with more tool calls than this folds repeated tools into groups ("12 x Read"). */
const GROUP_THRESHOLD = 8;
const AGENT_RECENT_MS = 30_000;

const SESSION_NODE = "session";
const turnId = (eventId: string): string => `turn:${eventId}`;
const agentNodeId = (agentId: string): string => `agent:${agentId}`;
const toolId = (eventId: string): string => `tool:${eventId}`;

interface ToolCall extends GraphItem {
  id: string;
}

interface Container {
  nodeId: string;
  tools: ToolCall[];
  tokens: number;
  firstTs?: string;
  lastTs?: string;
  model?: string;
  hasRunning: boolean;
  hasError: boolean;
}

const newContainer = (nodeId: string): Container => ({ nodeId, tools: [], tokens: 0, hasRunning: false, hasError: false });

const elapsed = (from: string, to: string): number => Date.parse(to) - Date.parse(from);

export function buildGraph(
  state: SessionState,
  events: Event[],
  group: boolean,
  stoppedAgents: ReadonlySet<string> = new Set(),
  now: number = Date.now(),
): Graph {
  const { session } = state;
  const results = new Map<string, Event>();
  for (const e of events) if (e.kind === "tool_result" && e.toolUseId) results.set(e.toolUseId, e);

  const agentByToolUse = new Map<string, string>();
  for (const [agentId, meta] of state.agents) if (meta.toolUseId) agentByToolUse.set(meta.toolUseId, agentId);

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const edge = (source: string, target: string): void => {
    edges.push({ id: `${source}->${target}`, source, target });
  };
  const containers = new Map<string, Container>();
  const containerFor = (nodeId: string): Container => {
    let c = containers.get(nodeId);
    if (!c) {
      c = newContainer(nodeId);
      containers.set(nodeId, c);
    }
    return c;
  };

  const rootContainer = containerFor(SESSION_NODE);
  nodes.push({
    id: SESSION_NODE,
    type: "session",
    data: { label: session.title ?? session.cwd, summary: session.cwd, model: session.model, tokens: session.usage.input + session.usage.output },
  });

  const toolStatus = (use: Event, result?: Event): NodeStatus | undefined => {
    if (result) return result.isError ? "error" : "ok";
    // With no result, a quiet session means the tool was interrupted, not that it is still going.
    return session.status === "active" ? "running" : undefined;
  };

  // Subagent nodes first, so an agent's events can find their node whatever order they arrive in.
  const agentContainer = new Map<string, Container>();
  for (const agentId of state.agents.keys()) agentContainer.set(agentId, containerFor(agentNodeId(agentId)));
  const ownerOf = (agentId: string): Container => {
    const known = agentContainer.get(agentId);
    if (known) return known;
    const c = containerFor(agentNodeId(agentId));
    agentContainer.set(agentId, c);
    return c;
  };

  const agentParent = new Map<string, string>();
  const agentUse = new Map<string, Event>();
  let currentTurn: Container = rootContainer;
  let previousTurn: string = SESSION_NODE;
  const turnNodes = new Map<string, GraphNode>();

  for (const e of events) {
    if (e.kind === "hook" || e.kind === "subagent_start" || e.kind === "subagent_stop") continue;

    if (e.kind === "user" && !e.agentId && !e.isSidechain) {
      const id = turnId(e.id);
      const node: GraphNode = { id, type: "turn", data: { label: `Turn ${turnNodes.size + 1}`, summary: e.summary } };
      nodes.push(node);
      turnNodes.set(id, node);
      edge(previousTurn, id);
      previousTurn = id;
      currentTurn = containerFor(id);
      currentTurn.firstTs = e.ts;
      currentTurn.lastTs = e.ts;
      continue;
    }

    const owner = e.agentId ? ownerOf(e.agentId) : currentTurn;
    owner.firstTs ??= e.ts;
    if (!owner.lastTs || e.ts > owner.lastTs) owner.lastTs = e.ts;
    if (e.usage) owner.tokens += e.usage.input + e.usage.output;
    if (e.model) owner.model = e.model;

    if (e.kind !== "tool_use" || !e.toolUseId) continue;

    const result = results.get(e.toolUseId);
    const linkedAgent = agentByToolUse.get(e.toolUseId);
    if (linkedAgent) {
      agentParent.set(linkedAgent, owner.nodeId);
      agentUse.set(linkedAgent, e);
      if (result?.isError) owner.hasError = true;
      continue;
    }
    const status = toolStatus(e, result);
    if (status === "running") owner.hasRunning = true;
    if (status === "error") owner.hasError = true;
    owner.tools.push({
      id: toolId(e.id),
      label: e.toolName ?? "tool",
      status,
      durationMs: result ? elapsed(e.ts, result.ts) : undefined,
      summary: e.summary,
      input: e.detail,
      result: result?.detail,
    });
  }

  for (const [agentId, container] of agentContainer) {
    const meta = state.agents.get(agentId);
    const use = agentUse.get(agentId);
    const result = use?.toolUseId ? results.get(use.toolUseId) : undefined;
    const parent = agentParent.get(agentId) ?? SESSION_NODE;

    const recentlyActive = container.lastTs !== undefined && now - Date.parse(container.lastTs) < AGENT_RECENT_MS;
    const running = !stoppedAgents.has(agentId) && session.status === "active" && (recentlyActive || (use !== undefined && !result));
    const status: NodeStatus = running ? "running" : result?.isError ? "error" : "ok";
    if (running) containerFor(parent).hasRunning = true;

    nodes.push({
      id: container.nodeId,
      type: "subagent",
      data: {
        label: meta?.agentType ?? "Subagent",
        summary: meta?.description ?? use?.summary ?? agentId,
        status,
        model: container.model,
        tokens: container.tokens,
        durationMs: container.firstTs && container.lastTs ? elapsed(container.firstTs, container.lastTs) : undefined,
        input: use?.detail,
        result: result?.detail,
        container: parent === SESSION_NODE ? undefined : parent,
        count: container.tools.length,
      },
    });
    edge(parent, container.nodeId);
  }

  for (const container of containers.values()) {
    emitTools(container, group, nodes, edge);
    const node = turnNodes.get(container.nodeId);
    if (node) {
      node.data.tokens = container.tokens;
      node.data.model = container.model;
      node.data.count = container.tools.length;
      node.data.status = container.hasRunning ? "running" : container.hasError ? "error" : "ok";
      if (container.firstTs && container.lastTs) node.data.durationMs = elapsed(container.firstTs, container.lastTs);
    }
  }
  // Tools of a subagent inside a turn: reflect "running" up to that turn.
  for (const [agentId] of agentContainer) {
    const parent = agentParent.get(agentId);
    const node = parent ? turnNodes.get(parent) : undefined;
    if (node && containers.get(agentNodeId(agentId))?.hasRunning) node.data.status = "running";
  }
  return { nodes, edges };
}

function emitTools(container: Container, group: boolean, nodes: GraphNode[], edge: (s: string, t: string) => void): void {
  const parent = container.nodeId;
  const containerField = parent === SESSION_NODE ? undefined : parent;
  const emitSingle = (t: ToolCall): void => {
    nodes.push({
      id: t.id,
      type: "tool",
      data: { label: t.label, status: t.status, durationMs: t.durationMs, summary: t.summary, input: t.input, result: t.result, container: containerField },
    });
    edge(parent, t.id);
  };

  if (!group || container.tools.length <= GROUP_THRESHOLD) {
    container.tools.forEach(emitSingle);
    return;
  }
  const byName = new Map<string, ToolCall[]>();
  for (const tool of container.tools) byName.set(tool.label, [...(byName.get(tool.label) ?? []), tool]);
  for (const [name, calls] of byName) {
    if (calls.length === 1) {
      emitSingle(calls[0]!);
      continue;
    }
    const id = `group:${parent}:${name}`;
    const statuses = calls.map((c) => c.status);
    const status: NodeStatus | undefined = statuses.includes("running")
      ? "running"
      : statuses.includes("error")
        ? "error"
        : statuses.includes("ok")
          ? "ok"
          : undefined;
    nodes.push({
      id,
      type: "group",
      data: {
        label: `${calls.length} x ${name}`,
        status,
        count: calls.length,
        // No group duration: calls made in parallel overlap, so their sum means nothing.
        container: containerField,
        items: calls.map(({ id: _id, ...item }) => item),
      },
    });
    edge(parent, id);
  }
}
