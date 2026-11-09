import { randomUUID } from "node:crypto";
import type { Event } from "@claude-monitor/shared";
import type { HookEffect, HookUpdate } from "./store.js";

const SUMMARY_MAX = 120;

const EFFECTS: Record<string, HookEffect> = {
  SessionStart: "started",
  UserPromptSubmit: "prompt",
  PreToolUse: "tool_start",
  PostToolUse: "tool_end",
  PostToolUseFailure: "tool_end",
  Stop: "stopped",
  StopFailure: "stopped",
  SessionEnd: "ended",
  SubagentStop: "subagent_stopped",
};

const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

/**
 * Validates loosely: an unknown event still shows up in the event list, but a body with no session
 * id returns null. Prompts, tool input and last_assistant_message are deliberately never read:
 * the transcript is the source for those, and truncated.
 */
export function parseHook(body: unknown, now: Date = new Date()): HookUpdate | null {
  if (body === null || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const sessionId = str(b.session_id);
  const name = str(b.hook_event_name);
  if (!sessionId || !name) return null;

  const ts = now.toISOString();
  const toolName = str(b.tool_name);
  const agentId = str(b.agent_id);
  const events: Event[] = [
    {
      id: `hook:${randomUUID()}`,
      sessionId,
      ts,
      kind: "hook",
      toolName,
      toolUseId: str(b.tool_use_id),
      agentId,
      isSidechain: agentId ? true : undefined,
      summary: (toolName ? `${name}: ${toolName}` : name).slice(0, SUMMARY_MAX),
    },
  ];
  if (name === "SubagentStart" || name === "SubagentStop") {
    events.push({
      id: `hook:${randomUUID()}`,
      sessionId,
      ts,
      kind: name === "SubagentStart" ? "subagent_start" : "subagent_stop",
      agentId,
      isSidechain: true,
      summary: (str(b.agent_type) ?? agentId ?? "subagent").slice(0, SUMMARY_MAX),
    });
  }

  // A subagent's tools must not read as the session's current tool, and its Stop as the session's.
  const isAgentTool = Boolean(agentId) && (name === "PreToolUse" || name.startsWith("PostToolUse"));
  return {
    sessionId,
    ts,
    cwd: str(b.cwd),
    effect: isAgentTool ? "none" : (EFFECTS[name] ?? "none"),
    toolName,
    toolUseId: str(b.tool_use_id),
    agentId,
    events,
  };
}
