import type { ToolRef } from "./tools.js";

/**
 * Where a session is in its loop. Claude Code writes a transcript line only once a content block is
 * complete, so phases are known at block boundaries; anything finer (token streaming) is simulated
 * by the UI.
 */
export type Phase =
  /** The turn is over. Claude waits for the person. */
  | "waiting_input"
  /** A request is on its way to the model: a prompt was sent, or tool results were returned. */
  | "requesting"
  | "thinking"
  /** Writing text for the chat. */
  | "writing"
  /** Running a tool (see `tool` for which). */
  | "tool"
  /** Blocked on the person: a permission prompt or a question. */
  | "waiting_permission"
  | "compacting"
  | "ended";

export const PHASES: readonly Phase[] = [
  "waiting_input",
  "requesting",
  "thinking",
  "writing",
  "tool",
  "waiting_permission",
  "compacting",
  "ended",
];

export const PHASE_LABEL: Record<Phase, string> = {
  waiting_input: "Waiting for you",
  requesting: "Sending to model",
  thinking: "Thinking",
  writing: "Writing response",
  tool: "Running tool",
  waiting_permission: "Needs your input",
  compacting: "Compacting context",
  ended: "Ended",
};

/** Phases in which the session is working, rather than waiting on someone. */
export const WORKING_PHASES: ReadonlySet<Phase> = new Set(["requesting", "thinking", "writing", "tool", "compacting"]);

export interface RunningTool extends ToolRef {
  toolUseId?: string;
  startedAt: string;
}

export interface Activity {
  phase: Phase;
  /** When this phase began. */
  since: string;
  /** Set while phase is "tool". */
  tool?: RunningTool;
  /** Subagents of this session running right now. */
  agents: string[];
  /** What set the phase, e.g. "hook:PreToolUse" or "transcript:thinking". For the detail panel. */
  source: string;
}

export const initialActivity = (ts: string): Activity => ({
  phase: "waiting_input",
  since: ts,
  agents: [],
  source: "init",
});
