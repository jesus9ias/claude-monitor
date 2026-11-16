import { memo } from "react";
import type { PipelineStats } from "@claude-monitor/shared";
import { CATEGORY_ICON, Icon, type IconName } from "../../../components/Icon";
import { formatTokens } from "../../../format";
import { BLOCKS, EDGES, TOOLS_BOX, VIEW, type Block, type BlockId, type Visual } from "./layout";

const PARTICLES = 3;
const PARTICLE_S = 1.2;

const BLOCK_ICON: Record<string, IconName> = { you: "you", model: "model", output: "output", context: "context", router: "router", needs: "input" };
const iconFor = (id: BlockId): IconName =>
  id.startsWith("cat:") ? CATEGORY_ICON[id.slice(4) as keyof typeof CATEGORY_ICON] : (BLOCK_ICON[id] ?? "other");

/** The active path takes the color of the block it leads to. */
function edgeTone(id: string): string {
  if (id === "router-needs") return "warn";
  if (id === "router-tools" || id.startsWith("tools:")) return "tool";
  if (id === "model-output") return "neutral";
  return "model";
}

/** A tool category with no call in this session. */
function unused(b: Block, stats: PipelineStats | null): boolean {
  if (!stats || !b.id.startsWith("cat:")) return false;
  const c = b.id.slice(4) as keyof PipelineStats["categories"];
  return c === "agent" ? stats.agents.length === 0 && stats.categories.agent.calls === 0 : stats.categories[c].calls === 0;
}

/** The small second line of each block: what it has done in this session. */
function subtitle(b: Block, stats: PipelineStats | null, visual: Visual, mcpServer?: string): string {
  if (!stats) return "";
  switch (b.id) {
    case "you":
      return `${stats.prompts} prompt${stats.prompts === 1 ? "" : "s"}`;
    case "model":
      return `${formatTokens(stats.model.usage.output)} out · ${stats.model.messages} msgs`;
    case "output":
      return `${stats.model.textBlocks} replies`;
    case "context": {
      const pct = stats.context.windowTokens ? Math.round((stats.context.tokens / stats.context.windowTokens) * 100) : 0;
      return `${pct}% of ${formatTokens(stats.context.windowTokens)}`;
    }
    case "router": {
      const total = Object.values(stats.categories).reduce((n, c) => n + c.calls, 0);
      return `${total} calls`;
    }
    case "needs":
      return `${stats.permissionPrompts} prompts`;
    default: {
      const category = b.id.slice(4) as keyof PipelineStats["categories"];
      if (category === "mcp" && visual.active.has(b.id) && mcpServer) return mcpServer;
      if (category === "mcp") {
        const servers = Object.keys(stats.mcpServers).length;
        return `${stats.categories.mcp.calls} · ${servers} server${servers === 1 ? "" : "s"}`;
      }
      if (category === "agent") {
        const running = stats.agents.filter((a) => a.status === "running").length;
        return running ? `${running} running` : `${stats.agents.length} total`;
      }
      const c = stats.categories[category];
      return `${c.calls} call${c.calls === 1 ? "" : "s"}${c.errors ? ` · ${c.errors} err` : ""}`;
    }
  }
}

/** Context fill bar under the Context block's text. */
function ContextBar({ b, stats }: { b: Block; stats: PipelineStats | null }) {
  if (!stats?.context.windowTokens) return null;
  const ratio = Math.min(1, stats.context.tokens / stats.context.windowTokens);
  const w = b.w - 24;
  const level = ratio > 0.85 ? "critical" : ratio > 0.65 ? "warning" : "ok";
  return (
    <g aria-hidden="true">
      <rect x={b.x + 12} y={b.y + b.h - 9} width={w} height={4} rx={2} className="pl-bar-track" />
      <rect x={b.x + 12} y={b.y + b.h - 9} width={Math.max(2, w * ratio)} height={4} rx={2} className={`pl-bar pl-bar-${level}`} />
    </g>
  );
}

interface Props {
  visual: Visual;
  stats: PipelineStats | null;
  selected: BlockId | null;
  onSelect: (id: BlockId) => void;
  mcpServer?: string;
  reducedMotion: boolean;
}

export const PipelineDiagram = memo(function PipelineDiagram({ visual, stats, selected, onSelect, mcpServer, reducedMotion }: Props) {
  const flowing = new Map(visual.flows.map((f) => [f.edge, f]));
  return (
    <svg className="pl-svg" viewBox={`0 0 ${VIEW.w} ${VIEW.h}`} role="img" aria-labelledby="pl-title">
      <title id="pl-title">Session pipeline: where Claude is in its loop</title>
      <defs>
        <marker id="pl-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M2 1L8 5L2 9" fill="none" stroke="context-stroke" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </marker>
      </defs>

      <rect className="pl-tools-box" x={TOOLS_BOX.x} y={TOOLS_BOX.y} width={TOOLS_BOX.w} height={TOOLS_BOX.h} rx={12} />
      <text className="pl-caption" x={TOOLS_BOX.x + TOOLS_BOX.w - 14} y={TOOLS_BOX.y + TOOLS_BOX.h - 8} textAnchor="end">
        Tools by category
      </text>

      {EDGES.map((e) => {
        const on = flowing.has(e.id);
        if (e.hidden && !on) return <path key={e.id} id={`pl-${e.id}`} d={e.d} className="pl-edge-hidden" />;
        return <path key={e.id} id={`pl-${e.id}`} d={e.d} className={`pl-edge ${on ? `is-on pl-edge-${edgeTone(e.id)}` : ""}`} markerEnd={e.hidden ? undefined : "url(#pl-arrow)"} />;
      })}

      {BLOCKS.map((b) => {
        const isActive = visual.active.has(b.id);
        const isPulse = visual.pulse.has(b.id) && !reducedMotion;
        const small = b.id.startsWith("cat:");
        return (
          <g
            key={b.id}
            className={`pl-block pl-tone-${b.tone} ${isActive ? "is-active" : unused(b, stats) ? "is-unused" : ""} ${isPulse ? "is-pulse" : ""} ${selected === b.id ? "is-selected" : ""}`}
            role="button"
            tabIndex={0}
            aria-pressed={selected === b.id}
            aria-label={`${b.label}: ${subtitle(b, stats, visual, mcpServer)}`}
            onClick={() => onSelect(b.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect(b.id);
              }
            }}
          >
            <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={12} />
            <g className="pl-icon" transform={`translate(${b.x + 10} ${b.y + (small ? 11 : 13)})`}>
              <Icon name={iconFor(b.id)} size={small ? 14 : 16} />
            </g>
            <text className={small ? "pl-label pl-label-sm" : "pl-label"} x={b.x + (small ? 30 : 34)} y={b.y + (small ? 18 : 21)} dominantBaseline="central">
              {b.label}
            </text>
            <text className={small ? "pl-sub pl-sub-sm" : "pl-sub"} x={b.x + 10} y={b.y + (small ? 37 : 40)} dominantBaseline="central">
              {subtitle(b, stats, visual, mcpServer)}
            </text>
            {b.id === "context" && <ContextBar b={b} stats={stats} />}
          </g>
        );
      })}

      {!reducedMotion &&
        visual.flows.map((f) =>
          Array.from({ length: PARTICLES }, (_, i) => (
            <circle key={`${f.edge}:${i}`} r={3.5} className="pl-particle">
              <animateMotion
                dur={`${PARTICLE_S}s`}
                begin={`${(i * PARTICLE_S) / PARTICLES}s`}
                repeatCount="indefinite"
                keyPoints={f.reverse ? "1;0" : "0;1"}
                keyTimes="0;1"
                calcMode="linear"
              >
                <mpath href={`#pl-${f.edge}`} />
              </animateMotion>
            </circle>
          )),
        )}
    </svg>
  );
});
