import dagre from "@dagrejs/dagre";
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { totalTokens, type Graph, type GraphItem, type GraphNode, type GraphNodeData, type NodeStatus } from "@claude-monitor/shared";
import { api, subscribe } from "../api";
import { formatDuration, formatTokens } from "../format";

const NODE_WIDTH = 230;
const NODE_HEIGHT = 74;
const REFRESH_MS = 1000;
/** Graphs up to this size open fully expanded. */
const EXPAND_ALL_UP_TO = 15;
/** Fitting more nodes than this on screen makes them too small to read. */
const FIT_ALL_UP_TO = 12;
const READABLE_ZOOM = 0.85;

type FlowNodeData = GraphNodeData & { kind: GraphNode["type"]; expanded?: boolean; onToggle?: () => void };
type FlowNode = Node<FlowNodeData>;

const STATUS_LABEL: Record<NodeStatus, string> = { running: "running", ok: "ok", error: "error" };

const Status = ({ status }: { status?: NodeStatus }) =>
  status ? <span className={`node-status node-status-${status}`}>{STATUS_LABEL[status]}</span> : null;

const MonitorNode = memo(function MonitorNode({ data }: NodeProps<FlowNode>) {
  const canToggle = data.onToggle !== undefined;
  return (
    <div className={`flow-node flow-node-${data.kind} ${data.status === "running" ? "running" : ""} ${data.status === "error" ? "failed" : ""}`}>
      {data.kind !== "session" && <Handle type="target" position={Position.Top} isConnectable={false} />}
      <div className="flow-node-head">
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

function Drawer({ node, onClose }: { node: GraphNode; onClose: () => void }) {
  const { data } = node;
  return (
    <aside className="drawer" aria-label="Node details">
      <div className="drawer-head">
        <h2>{data.label}</h2>
        <button className="ghost" onClick={onClose}>
          Close
        </button>
      </div>
      <dl className="drawer-facts">
        {data.status && (
          <>
            <dt>Status</dt>
            <dd>{data.status}</dd>
          </>
        )}
        {data.durationMs !== undefined && (
          <>
            <dt>Duration</dt>
            <dd>{formatDuration(data.durationMs)}</dd>
          </>
        )}
        {data.tokens !== undefined && data.tokens > 0 && (
          <>
            <dt>Tokens</dt>
            <dd>{formatTokens(data.tokens)}</dd>
          </>
        )}
        {data.model && (
          <>
            <dt>Model</dt>
            <dd>{data.model}</dd>
          </>
        )}
      </dl>
      {data.summary && <p className="drawer-summary">{data.summary}</p>}
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
    </aside>
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
    fetch(`/api/sessions/${encodeURIComponent(sessionId)}/graph${group ? "" : "?group=0"}`)
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json() as Promise<Graph>;
      })
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

  const { nodes, edges } = useMemo(() => {
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
        <div className="flow-actions">
          <label className="check">
            <input type="checkbox" checked={group} onChange={(e) => setGroup(e.target.checked)} /> Group repeated tools
          </label>
          <button className="ghost" onClick={() => setAll(true)}>
            Expand all
          </button>
          <button className="ghost" onClick={() => setAll(false)}>
            Collapse all
          </button>
        </div>
      </div>
      <div className="flow-wrap">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          nodesConnectable={false}
          nodesDraggable={false}
          minZoom={0.05}
          maxZoom={1.5}
          onlyRenderVisibleElements
          colorMode="system"
          onNodeClick={(_, node) => setSelectedId(node.id)}
          onPaneClick={() => setSelectedId(null)}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={24} />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable />
        </ReactFlow>
        {selected && <Drawer node={selected} onClose={() => setSelectedId(null)} />}
      </div>
    </>
  );
}

export function FlowPage() {
  const { id = "" } = useParams();
  const [title, setTitle] = useState<string>("");
  const [usage, setUsage] = useState<string>("");

  useEffect(() => {
    api
      .session(id)
      .then(({ session }) => {
        setTitle(session.title ?? session.cwd);
        setUsage(`${formatTokens(totalTokens(session.usage))} tokens`);
      })
      .catch(() => undefined);
  }, [id]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{title || "Flow"}</h1>
          <div className="muted">
            <Link to={`/sessions/${id}`}>Back to session</Link>
            {usage && ` · ${usage}`}
          </div>
        </div>
      </div>
      <ReactFlowProvider>
        <FlowCanvas sessionId={id} />
      </ReactFlowProvider>
    </>
  );
}
