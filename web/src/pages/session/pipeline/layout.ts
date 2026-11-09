/**
 * Geometry of the pipeline diagram and how an Activity lights it up. Pure: no React, no DOM.
 * Coordinates are in a 680-wide viewBox.
 */
import { TOOL_CATEGORY_LABEL, type Activity, type ToolCategory } from "@claude-monitor/shared";

export type BlockId = "you" | "context" | "model" | "output" | "router" | "needs" | `cat:${ToolCategory}`;
export type BlockTone = "neutral" | "model" | "tool" | "warn";

export interface Block {
  id: BlockId;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  tone: BlockTone;
}

export const VIEW = { w: 680, h: 410 };
export const TOOLS_BOX = { x: 30, y: 222, w: 620, h: 172 };

const BIG = { w: 130, h: 56 };
const CAT = { w: 104, h: 52 };
const COLS = [40, 164, 288, 412, 536];
const ROW1 = 252;
const ROW2 = 316;

export const CATEGORY_ORDER: ToolCategory[] = ["read", "search", "edit", "shell", "web", "mcp", "skill", "agent", "planning", "other"];

export const BLOCKS: Block[] = [
  { id: "you", label: "You", x: 40, y: 40, ...BIG, tone: "neutral" },
  { id: "model", label: "Model", x: 275, y: 40, ...BIG, tone: "model" },
  { id: "output", label: "Output", x: 510, y: 40, ...BIG, tone: "neutral" },
  { id: "context", label: "Context", x: 40, y: 140, ...BIG, tone: "neutral" },
  { id: "router", label: "Tool router", x: 275, y: 140, ...BIG, tone: "model" },
  { id: "needs", label: "Needs input", x: 510, y: 140, ...BIG, tone: "warn" },
  ...CATEGORY_ORDER.map((category, i): Block => ({
    id: `cat:${category}`,
    label: category === "agent" ? "Subagents" : category === "mcp" ? "MCP" : TOOL_CATEGORY_LABEL[category],
    x: COLS[i % 5]!,
    y: i < 5 ? ROW1 : ROW2,
    ...CAT,
    tone: "tool",
  })),
];

export const blockById = new Map(BLOCKS.map((b) => [b.id, b]));

export type EdgeId = "you-model" | "context-model" | "model-output" | "model-router" | "router-model" | "router-needs" | "router-tools" | `tools:${ToolCategory}`;

export interface Edge {
  id: EdgeId;
  d: string;
  /** Edges into the tools box are drawn only while in use; the rest always. */
  hidden?: boolean;
}

function toolPath(category: ToolCategory): string {
  const b = blockById.get(`cat:${category}`)!;
  const cx = b.x + b.w / 2;
  if (b.y === ROW1) return `M352 196 L352 236 L${cx} 236 L${cx} ${ROW1}`;
  // Second row: down the gap beside the column, so the path never crosses a first-row box.
  const gap = b.x === COLS[0] ? b.x + b.w + 10 : b.x - 10;
  return `M352 196 L352 236 L${gap} 236 L${gap} ${ROW2 - 6} L${cx} ${ROW2 - 6} L${cx} ${ROW2}`;
}

export const EDGES: Edge[] = [
  { id: "you-model", d: "M170 62 L275 62" },
  { id: "context-model", d: "M170 168 L230 168 L230 84 L275 84" },
  { id: "model-output", d: "M405 68 L510 68" },
  { id: "model-router", d: "M330 96 L330 140" },
  { id: "router-model", d: "M352 140 L352 96" },
  { id: "router-needs", d: "M405 168 L510 168" },
  { id: "router-tools", d: "M330 196 L330 222" },
  ...CATEGORY_ORDER.map((c): Edge => ({ id: `tools:${c}`, d: toolPath(c), hidden: true })),
];

export interface Flow {
  edge: EdgeId;
  /** Particles run end to start: results coming back. */
  reverse?: boolean;
}

export interface Visual {
  active: Set<BlockId>;
  pulse: Set<BlockId>;
  flows: Flow[];
  /** The block that stands for "where Claude is" (for the status line and the default drawer). */
  focus?: BlockId;
}

const AFTER_TOOL = /tool_result|PostToolUse|PermissionDenied|after_tool/;

/** What to light and animate for an activity. Only the phase and its source are read. */
export function visualFor(activity: Pick<Activity, "phase" | "tool" | "source" | "agents">): Visual {
  const active = new Set<BlockId>();
  const pulse = new Set<BlockId>();
  const flows: Flow[] = [];
  let focus: BlockId | undefined;

  switch (activity.phase) {
    case "waiting_input":
      focus = "you";
      active.add("you");
      break;
    case "requesting":
      focus = "model";
      active.add("model");
      if (/compact/.test(activity.source)) flows.push({ edge: "context-model" });
      else if (AFTER_TOOL.test(activity.source)) {
        active.add("router");
        flows.push({ edge: "router-model" });
      } else flows.push({ edge: "you-model" });
      break;
    case "thinking":
      focus = "model";
      active.add("model");
      pulse.add("model");
      flows.push({ edge: "context-model" });
      break;
    case "writing":
      focus = "output";
      active.add("model").add("output");
      flows.push({ edge: "model-output" });
      break;
    case "tool": {
      const category = activity.tool?.category ?? "other";
      focus = `cat:${category}`;
      active.add("router").add(focus);
      pulse.add(focus);
      flows.push({ edge: "model-router" }, { edge: `tools:${category}` });
      break;
    }
    case "waiting_permission":
      focus = "needs";
      active.add("router").add("needs");
      pulse.add("needs");
      flows.push({ edge: "router-needs" });
      break;
    case "compacting":
      focus = "context";
      active.add("context");
      pulse.add("context");
      flows.push({ edge: "context-model", reverse: true });
      break;
    case "ended":
      break;
  }
  if (activity.agents.length) {
    active.add("cat:agent");
    pulse.add("cat:agent");
  }
  return { active, pulse, flows, focus };
}
