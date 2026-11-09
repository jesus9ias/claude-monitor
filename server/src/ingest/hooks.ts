/**
 * The ONLY place that knows the Claude Code hook payload format. Prompts, tool input, messages and
 * last_assistant_message are deliberately never read: the transcript is the source for content, and
 * it is truncated there.
 */
import { randomUUID } from "node:crypto";
import type { Event } from "@claude-monitor/shared";
import type { Signal, SignalKind } from "../domain/activity.js";

const SUMMARY_MAX = 120;

/** Events the installer subscribes to. Order is irrelevant; the installer reads this list. */
export const HOOK_EVENTS_WITH_MATCHER = ["PreToolUse", "PostToolUse", "PostToolUseFailure", "PermissionRequest", "PermissionDenied"];
export const HOOK_EVENTS_WITHOUT_MATCHER = [
  "SessionStart",
  "UserPromptSubmit",
  "Notification",
  "SubagentStart",
  "SubagentStop",
  "PreCompact",
  "PostCompact",
  "Elicitation",
  "Stop",
  "StopFailure",
  "SessionEnd",
];

const SIGNALS: Record<string, SignalKind> = {
  SessionStart: "start",
  UserPromptSubmit: "prompt",
  PreToolUse: "tool_start",
  PostToolUse: "tool_end",
  PostToolUseFailure: "tool_end",
  PermissionRequest: "permission",
  // The denial goes back to the model as a tool result.
  PermissionDenied: "tool_end",
  Elicitation: "permission",
  PreCompact: "compact_start",
  PostCompact: "compact_end",
  Stop: "stop",
  StopFailure: "stop",
  SessionEnd: "end",
  SubagentStart: "agent_start",
  SubagentStop: "agent_stop",
};

/** Notification hooks say why Claude is notifying; only the type is read, never the message. */
const NOTIFICATION_SIGNALS: Record<string, SignalKind> = {
  permission_prompt: "permission",
  elicitation_dialog: "permission",
  idle_prompt: "waiting_input",
};

export interface HookUpdate {
  sessionId: string;
  ts: string;
  cwd?: string;
  signals: Signal[];
  events: Event[];
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

/** Validates loosely: an unknown event still shows up in the event list. No session id: null. */
export function parseHook(body: unknown, now: Date = new Date()): HookUpdate | null {
  if (body === null || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const sessionId = str(b.session_id);
  const name = str(b.hook_event_name);
  if (!sessionId || !name) return null;

  const ts = now.toISOString();
  const toolName = str(b.tool_name);
  const toolUseId = str(b.tool_use_id);
  const agentId = str(b.agent_id);
  const notificationType = name === "Notification" ? str(b.notification_type) : undefined;

  const label = toolName ?? notificationType;
  const events: Event[] = [
    {
      id: `hook:${randomUUID()}`,
      sessionId,
      ts,
      kind: "hook",
      toolName,
      toolUseId,
      agentId,
      isSidechain: agentId ? true : undefined,
      summary: (label ? `${name}: ${label}` : name).slice(0, SUMMARY_MAX),
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

  const kind = notificationType ? NOTIFICATION_SIGNALS[notificationType] : SIGNALS[name];
  const signals: Signal[] = kind ? [{ kind, ts, source: `hook:${name}`, toolName, toolUseId, agentId }] : [];
  return { sessionId, ts, cwd: str(b.cwd), signals, events };
}
