import dagre from "@dagrejs/dagre";
import {
  Background,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useViewport,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  classifyTool,
  TOOL_CATEGORIES,
  TOOL_CATEGORY_LABEL,
  type Graph,
  type GraphItem,
  type GraphNode,
  type GraphNodeData,
  type NodeStatus,
  type ToolCategory,
} from "@claude-monitor/shared";
import { api, subscribe } from "../../api";
import { CATEGORY_ICON, Icon, type IconName } from "../../components/Icon";
import { formatCost, formatDuration, formatTokens } from "../../format";
import { useSession } from "../../state/live";

const NODE_WIDTH = 230;
const NODE_HEIGHT = 74;
const REFRESH_MS = 1000;
/** Graphs up to this size open fully expanded. */
const EXPAND_ALL_UP_TO = 15;
/** Fitting more nodes than this on screen makes them too small to read. */
const FIT_ALL_UP_TO = 12;
const READABLE_ZOOM = 0.85;

type FlowNodeData = GraphNodeData & { kind: GraphNode["type"]; expanded?: boolean; onToggle?: () => void; selected?: boolean };
type FlowNode = Node<FlowNodeData>;

const STATUS_LABEL: Record<NodeStatus, string> = { running: "running", ok: "ok", error: "error" };
const KIND_LABEL: Record<GraphNode["type"], string> = { session: "Session", turn: "Turn", tool: "Tool call", subagent: "Subagent", group: "Grouped calls" };

/** "12 x Read" → "Read"; a single tool node's label is the tool name. */
const toolNameOf = (n: { type: GraphNode["type"]; data: GraphNodeData }): string | undefined =>
  n.type === "tool" ? n.data.label : n.type === "group" ? n.data.label.replace(/^\d+ x /, "") : undefined;

function nodeIcon(kind: GraphNode["type"], label: string, data: GraphNodeData): IconName {
  if (kind === "session") return "sessions";
  if (kind === "turn") return "you";
  if (kind === "subagent") return "agent";
  const name = toolNameOf({ type: kind, data: { ...data, label } });
  return name ? CATEGORY_ICON[classifyTool(name).category] : "other";
}

const Status = ({ status }: { status?: NodeStatus }) =>
  status ? <span className={`node-status node-status-${status}`}>{STATUS_LABEL[status]}</span> : null;

const MonitorNode = memo(function MonitorNode({ data }: NodeProps<FlowNode>) {
  const canToggle = data.onToggle !== undefined;
  const cls = [
    "flow-node",
    `flow-node-${data.kind}`,
    data.status === "running" ? "running" : "",
    data.status === "error" ? "failed" : "",
    data.selected ? "is-selected" : "",
  ].join(" ");
  return (
    <div className={cls}>
      {data.kind !== "session" && <Handle type="target" position={Position.Top} isConnectable={false} />}
      <div className="flow-node-head">
        <span className="flow-node-icon">
          <Icon name={nodeIcon(data.kind, data.label, data)} size={14} />
        </span>
        <span className="flow-node-label">{data.label}</span>
        <Status status={data.status} />
      </div>
      {data.summary && <div className="flow-node-summary">{data.summary}</div>}
      <div className="flow-node-meta">
        {data.durationMs !== undefined && <span>{formatDuration(data.durationMs)}</span>}
        {data.tokens !== undefined && data.tokens > 0 && <span>{formatTokens(data.tokens)} tok</span>}
        {data.model && data.kind === "subagent" && <span>{data.model.replace(/^claude-/, "")}</span>}
        {canToggle && (
          <button
            className="flow-toggle nodrag"
            aria-expanded={data.expanded}
            onClick={(e) => {
              e.stopPropagation();
              data.onToggle?.();
            }}
          >
            {data.expanded ? "Collapse" : `Expand${data.count ? ` (${data.count})` : ""}`}
          </button>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} isConnectable={false} />
    </div>
  );
});

const nodeTypes = { monitor: MonitorNode };

function layout(nodes: FlowNode[], edges: Edge[]): FlowNode[] {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "TB", nodesep: 24, ranksep: 44 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of nodes) g.setNode(n.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  for (const e of edges) g.setEdge(e.source, e.target);
  dagre.layout(g);
  return nodes.map((n) => {
    const { x, y } = g.node(n.id);
    return { ...n, position: { x: x - NODE_WIDTH / 2, y: y - NODE_HEIGHT / 2 } };
  });
}

/** Opens the latest turn, what is running, and every path that leads to a subagent. */
function defaultExpanded(graph: Graph): Set<string> {
  const containers = graph.nodes.filter((n) => n.type === "turn" || n.type === "subagent");
  if (graph.nodes.length <= EXPAND_ALL_UP_TO) return new Set(containers.map((c) => c.id));
  const open = new Set<string>();
  const last = graph.nodes.filter((n) => n.type === "turn").pop();
  if (last) open.add(last.id);
  for (const n of containers) {
    if (n.data.status === "running") open.add(n.id);
    if (n.type === "subagent") {
      open.add(n.id);
      if (n.data.container) open.add(n.data.container);
    }
  }
  return open;
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

const statusColor = (status?: NodeStatus, kind?: GraphNode["type"]): string =>
  status === "running" ? "#3dd6c0" : status === "error" ? "#ff7a90" : kind === "subagent" ? "#8e9bff" : status === "ok" ? "#6b7186" : "#4a4f63";

interface CallStats {
  byCategory: Map<ToolCategory, number>;
  failed: { label: string; summary?: string }[];
  total: number;
}

/** Tool calls under a node: its own items, or every tool and group node inside it. */
function callsUnder(node: GraphNode, graph: Graph): CallStats {
  const byCategory = new Map<ToolCategory, number>();
  const failed: CallStats["failed"] = [];
  let total = 0;
  const add = (name: string, n: number) => {
    const c = classifyTool(name).category;
    byCategory.set(c, (byCategory.get(c) ?? 0) + n);
    total += n;
  };
  const countNode = (n: GraphNode) => {
    const name = toolNameOf(n);
    if (!name) return;
    if (n.type === "group" && n.data.items) {
      add(name, n.data.items.length);
      for (const item of n.data.items as GraphItem[]) if (item.status === "error") failed.push({ label: name, summary: item.summary });
    } else {
      add(name, n.type === "group" ? (n.data.count ?? 1) : 1);
      if (n.data.status === "error") failed.push({ label: name, summary: n.data.summary });
    }
  };
  if (node.type === "tool" || node.type === "group") countNode(node);
  else {
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    const within = (n: GraphNode): boolean => {
      if (node.type === "session") return true;
      let c = n.data.container;
      while (c) {
        if (c === node.id) return true;
        c = byId.get(c)?.data.container;
      }
      return false;
    };
    for (const n of graph.nodes) if (within(n)) countNode(n);
  }
  return { byCategory, failed, total };
}

function Inspector({ node, graph, sessionId, onClose }: { node: GraphNode; graph: Graph; sessionId: string; onClose: () => void }) {
  const { data } = node;
  const session = useSession(sessionId);
  const calls = useMemo(() => callsUnder(node, graph), [node, graph]);
  const max = Math.max(0, ...calls.byCategory.values());
  const toolName = toolNameOf(node);
  const eventsLink = `/sessions/${sessionId}/events${toolName ? `?q=${encodeURIComponent(toolName)}` : ""}`;
  return (
    <aside className="inspector card" aria-label="Node details">
      <div className="inspector-head">
        <span className="flow-node-icon">
          <Icon name={nodeIcon(node.type, data.label, data)} size={16} />
        </span>
        <div className="inspector-title">
          <span className="lbl">{KIND_LABEL[node.type]}</span>
          <h2>{data.label}</h2>
        </div>
        <button className="btn btn-icon" onClick={onClose} aria-label="Close details">
          <Icon name="close" size={16} />
        </button>
      </div>
      {data.summary && <p className="inspector-summary">{data.summary}</p>}
      <dl className="drawer-facts">
        <dt>Status</dt>
        <dd>{data.status ? <Status status={data.status} /> : "-"}</dd>
        <dt>Duration</dt>
        <dd>{data.durationMs !== undefined ? formatDuration(data.durationMs) : "-"}</dd>
        <dt>Tokens</dt>
        <dd>{data.tokens ? formatTokens(data.tokens) : "-"}</dd>
        <dt>Model</dt>
        <dd>{data.model ?? "-"}</dd>
        {node.type === "session" && (
          <>
            <dt>Cost</dt>
            <dd>{formatCost(session?.costUsd)}</dd>
          </>
        )}
      </dl>
      {calls.total > 0 && (
        <>
          <h3>Tool calls ({calls.total})</h3>
          <ul className="cat-bars">
            {TOOL_CATEGORIES.filter((c) => calls.byCategory.has(c)).map((c) => (
              <li key={c}>
                <Icon name={CATEGORY_ICON[c]} size={14} />
                <span>{TOOL_CATEGORY_LABEL[c]}</span>
                <span className="hbar">
                  <span style={{ width: `${max ? ((calls.byCategory.get(c) ?? 0) / max) * 100 : 0}%`, background: "var(--ember)" }} />
                </span>
                <strong>{calls.byCategory.get(c)}</strong>
              </li>
            ))}
          </ul>
        </>
      )}
      {calls.failed.length > 0 && (
        <>
          <h3 className="error">Failed calls ({calls.failed.length})</h3>
          <ul className="failed-calls">
            {calls.failed.slice(0, 10).map((f, i) => (
              <li key={i}>
                <Icon name="warning" size={14} />
                <span className="mono">{f.label}</span>
                <span className="muted ellipsis">{f.summary}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {data.input && (
        <>
          <h3>Input (truncated)</h3>
          <pre>{data.input}</pre>
        </>
      )}
      {data.result && (
        <>
          <h3>Result (truncated)</h3>
          <pre>{data.result}</pre>
        </>
      )}
      {data.items && (
        <>
          <h3>Calls ({data.items.length})</h3>
          <ul className="drawer-items">
            {data.items.map((item: GraphItem, i: number) => (
              <li key={i}>
                <details>
                  <summary>
                    <span className="drawer-item-summary">{item.summary ?? item.label}</span>
                    <Status status={item.status} />
                  </summary>
                  {item.durationMs !== undefined && <p className="muted small">{formatDuration(item.durationMs)}</p>}
                  {item.input && <pre>{item.input}</pre>}
                  {item.result && <pre>{item.result}</pre>}
                </details>
              </li>
            ))}
          </ul>
        </>
      )}
      <Link to={eventsLink} className="btn inspector-link">
        <Icon name="events" size={16} />
        {toolName ? `Find ${toolName} in Events` : "Open Events"}
      </Link>
    </aside>
  );
}

function ZoomControls({ onExpandAll, onCollapseAll }: { onExpandAll: () => void; onCollapseAll: () => void }) {
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  const { zoom } = useViewport();
  return (
    <div className="flow-controls">
      <div className="control-group">
        <button className="btn btn-icon" onClick={() => void zoomOut()} aria-label="Zoom out">
          <Icon name="minus" size={16} />
        </button>
        <span className="zoom-level" aria-live="polite">
          {Math.round(zoom * 100)}%
        </span>
        <button className="btn btn-icon" onClick={() => void zoomIn()} aria-label="Zoom in">
          <Icon name="plus" size={16} />
        </button>
      </div>
      <button className="btn" onClick={() => void fitView({ padding: 0.15, maxZoom: 1 })}>
        <Icon name="fit" size={16} />
        Fit
      </button>
      <div className="control-group">
        <button className="btn" onClick={onExpandAll}>
          Expand all
        </button>
        <button className="btn" onClick={onCollapseAll}>
          Collapse all
        </button>
      </div>
    </div>
  );
}

function FlowCanvas({ sessionId }: { sessionId: string }) {
  const [graph, setGraph] = useState<Graph | null>(null);
  const [failed, setFailed] = useState(false);
  const [group, setGroup] = useState(true);
  const [overrides, setOverrides] = useState<Map<string, boolean>>(new Map());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const defaults = useRef<Set<string> | null>(null);
  const placedViewport = useRef(false);
  const { fitView, setCenter } = useReactFlow();

  const load = useCallback(() => {
    api
      .graph(sessionId, group)
      .then((next) => {
        defaults.current ??= defaultExpanded(next);
        setGraph(next);
        setFailed(false);
      })
      .catch(() => setFailed(true));
  }, [sessionId, group]);

  useEffect(() => {
    load();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = subscribe((message) => {
      const id = message.type === "event_added" ? message.event.sessionId : message.type === "session_updated" ? message.session.id : null;
      if (id !== sessionId) return;
      timer ??= setTimeout(() => {
        timer = null;
        load();
      }, REFRESH_MS);
    }, load);
    return () => {
      unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, [sessionId, load]);

  const isExpanded = useCallback(
    (id: string): boolean => overrides.get(id) ?? (defaults.current?.has(id) || false),
    [overrides],
  );

  const toggle = useCallback(
    (id: string) => setOverrides((current) => new Map(current).set(id, !isExpanded(id))),
    [isExpanded],
  );

  const laidOut = useMemo(() => {
    if (!graph) return { nodes: [] as FlowNode[], edges: [] as Edge[] };
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    const visibleCache = new Map<string, boolean>();
    const isVisible = (n: GraphNode): boolean => {
      const cached = visibleCache.get(n.id);
      if (cached !== undefined) return cached;
      const container = n.data.container ? byId.get(n.data.container) : undefined;
      const visible = !container || (isExpanded(container.id) && isVisible(container));
      visibleCache.set(n.id, visible);
      return visible;
    };

    const hasChildren = new Set(graph.nodes.map((n) => n.data.container).filter(Boolean));
    const visibleNodes: FlowNode[] = graph.nodes.filter(isVisible).map((n) => ({
      id: n.id,
      type: "monitor",
      position: { x: 0, y: 0 },
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      draggable: false,
      data: {
        ...n.data,
        kind: n.type,
        expanded: isExpanded(n.id),
        onToggle: hasChildren.has(n.id) ? () => toggle(n.id) : undefined,
      },
    }));
    const ids = new Set(visibleNodes.map((n) => n.id));
    const visibleEdges: Edge[] = graph.edges
      .filter((e) => ids.has(e.source) && ids.has(e.target))
      .map((e) => ({ id: e.id, source: e.source, target: e.target, type: "smoothstep" }));
    return { nodes: layout(visibleNodes, visibleEdges), edges: visibleEdges };
  }, [graph, isExpanded, toggle]);

  // Selection is drawn on top of the layout, so picking a node never re-lays the graph.
  const nodes = useMemo(
    () => (selectedId ? laidOut.nodes.map((n) => (n.id === selectedId ? { ...n, data: { ...n.data, selected: true } } : n)) : laidOut.nodes),
    [laidOut.nodes, selectedId],
  );

  // Only once: after this the viewport belongs to the reader, and live updates must not move it.
  useEffect(() => {
    if (placedViewport.current || nodes.length === 0) return;
    placedViewport.current = true;
    requestAnimationFrame(() => {
      if (nodes.length <= FIT_ALL_UP_TO) {
        void fitView({ padding: 0.15, maxZoom: 1 });
        return;
      }
      const lastTurn = [...nodes].reverse().find((n) => n.data.kind === "turn");
      if (lastTurn) void setCenter(lastTurn.position.x + NODE_WIDTH / 2, lastTurn.position.y + NODE_HEIGHT * 2, { zoom: READABLE_ZOOM });
    });
  }, [nodes, fitView, setCenter]);

  const selected = selectedId ? (graph?.nodes.find((n) => n.id === selectedId) ?? null) : null;

  if (failed && !graph) return <p className="empty">The flow for this session could not be loaded.</p>;
  if (!graph) return <p className="empty">Loading…</p>;

  const toolCount = graph.nodes.reduce((sum, n) => sum + (n.type === "tool" ? 1 : n.type === "group" ? (n.data.count ?? 0) : 0), 0);
  const turnCount = graph.nodes.filter((n) => n.type === "turn").length;
  const agentCount = graph.nodes.filter((n) => n.type === "subagent").length;

  const setAll = (expanded: boolean): void => {
    const next = new Map<string, boolean>();
    for (const n of graph.nodes) if (n.type === "turn" || n.type === "subagent") next.set(n.id, expanded);
    setOverrides(next);
  };

  return (
    <>
      <div className="flow-bar">
        <span className="muted">
          {plural(turnCount, "turn")} · {plural(toolCount, "tool call")} · {plural(agentCount, "subagent")}
        </span>
        <label className="check">
          <input type="checkbox" checked={group} onChange={(e) => setGroup(e.target.checked)} /> Group repeated tools
        </label>
      </div>
      <div className={selected ? "flow-layout with-inspector" : "flow-layout"}>
        <div className="flow-wrap">
          <ReactFlow
            nodes={nodes}
            edges={laidOut.edges}
            nodeTypes={nodeTypes}
            nodesConnectable={false}
            nodesDraggable={false}
            minZoom={0.05}
            maxZoom={1.5}
            onlyRenderVisibleElements
            colorMode="dark"
            onNodeClick={(_, node) => setSelectedId(node.id)}
            onPaneClick={() => setSelectedId(null)}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={24} />
            <MiniMap pannable zoomable nodeColor={(n) => statusColor((n.data as FlowNodeData).status, (n.data as FlowNodeData).kind)} nodeStrokeWidth={0} />
          </ReactFlow>
          <div className="flow-legend" aria-label="Legend">
            <span>
              <span className="lg lg-running" /> running
            </span>
            <span>
              <span className="lg lg-ok" /> ok
            </span>
            <span>
              <span className="lg lg-error" /> error
            </span>
            <span>
              <span className="lg lg-agent" /> subagent
            </span>
          </div>
          <ZoomControls onExpandAll={() => setAll(true)} onCollapseAll={() => setAll(false)} />
        </div>
        {selected && <Inspector node={selected} graph={graph} sessionId={sessionId} onClose={() => setSelectedId(null)} />}
      </div>
    </>
  );
}

export function FlowTab() {
  const { id = "" } = useParams();
  return (
    <ReactFlowProvider>
      <FlowCanvas sessionId={id} />
    </ReactFlowProvider>
  );
}
