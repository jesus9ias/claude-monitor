import type { Phase, RunningTool } from "./activity.js";
import type { ToolCategory } from "./tools.js";
import type { NodeStatus, Usage } from "./types.js";

/** One tool call, as the pipeline drawer lists it. Text is already truncated by the parser. */
export interface PipelineCall {
  toolUseId?: string;
  name: string;
  mcpServer?: string;
  summary: string;
  status?: NodeStatus;
  startedAt: string;
  durationMs?: number;
  /** Set when a subagent made the call. */
  agentId?: string;
}

export interface CategoryStats {
  calls: number;
  errors: number;
  /** Duration of the most recent finished call. */
  lastDurationMs?: number;
  totalDurationMs: number;
  /** Calls with a result, which totalDurationMs covers. */
  finished: number;
  /** Newest first, at most PIPELINE_RECENT. */
  recent: PipelineCall[];
  byTool: Record<string, number>;
}

export interface PipelineAgent {
  agentId: string;
  type?: string;
  description?: string;
  model?: string;
  tokens: number;
  toolCalls: number;
  status: NodeStatus;
}

export interface ReplayStep {
  ts: string;
  phase: Phase;
  tool?: Omit<RunningTool, "startedAt">;
}

export interface PipelineStats {
  prompts: number;
  model: {
    name?: string;
    messages: number;
    thinkingBlocks: number;
    textBlocks: number;
    usage: Usage;
  };
  context: {
    /** Prompt size of the latest main-conversation message: input + cache read + cache write. */
    tokens: number;
    /** The model's context window. Grows to 1M once a message is seen above the standard window. */
    windowTokens: number;
    compactions: number;
  };
  categories: Record<ToolCategory, CategoryStats>;
  mcpServers: Record<string, { calls: number; errors: number }>;
  agents: PipelineAgent[];
  permissionPrompts: number;
  /** The phases of the last main-conversation turn, oldest first. For the replay. */
  lastTurn: ReplayStep[];
}

export const PIPELINE_RECENT = 20;
