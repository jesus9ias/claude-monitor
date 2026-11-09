import assert from "node:assert/strict";
import { test } from "node:test";
import { Bus } from "../src/bus.js";
import { Monitor } from "../src/domain/monitor.js";
import { parseHook } from "../src/ingest/hooks.js";

const at = (seconds: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, seconds));

function send(monitor: Monitor, name: string, seconds: number, extra: object = {}): void {
  const hook = parseHook({ session_id: "s", cwd: "/repo", hook_event_name: name, ...extra }, at(seconds));
  assert.ok(hook);
  monitor.applyHook(hook, at(seconds).getTime());
}

const sessionAt = (monitor: Monitor, seconds: number) => {
  monitor.tick(at(seconds).getTime());
  return monitor.sessions.get("s")!.session;
};

test("invalid bodies are ignored and unknown events kept with no signal", () => {
  for (const bad of [null, 1, "x", {}, { session_id: "s" }]) assert.equal(parseHook(bad), null);
  const unknown = parseHook({ session_id: "s", hook_event_name: "Whatever" });
  assert.equal(unknown?.signals.length, 0);
  assert.equal(unknown?.events.length, 1);
});

test("hook payload content never reaches an event or a signal", () => {
  const hook = parseHook({
    session_id: "s",
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_input: { command: "export TOKEN=secret" },
  });
  assert.ok(!JSON.stringify(hook).includes("secret"));
  const note = parseHook({ session_id: "s", hook_event_name: "Notification", notification_type: "permission_prompt", message: "secret" });
  assert.ok(!JSON.stringify(note).includes("secret"));
});

test("a tool flips active and shows in the activity, and Post clears it", () => {
  const m = new Monitor({}, new Bus());
  send(m, "SessionStart", 0);
  send(m, "PreToolUse", 1, { tool_name: "mcp__github__create_pr", tool_use_id: "t1" });
  const during = sessionAt(m, 200); // Long tool: past the 30s heuristic.
  assert.equal(during.status, "active");
  assert.equal(during.activity.phase, "tool");
  assert.equal(during.activity.tool?.category, "mcp");
  assert.equal(during.activity.tool?.mcpServer, "github");
  send(m, "PostToolUse", 201, { tool_name: "mcp__github__create_pr", tool_use_id: "t1" });
  assert.equal(m.sessions.get("s")!.session.activity.phase, "requesting");
  assert.equal(m.sessions.get("s")!.session.activity.tool, undefined);
});

test("Stop flips to idle and waiting at once, and a new prompt reactivates", () => {
  const m = new Monitor({}, new Bus());
  send(m, "SessionStart", 0);
  assert.equal(sessionAt(m, 1).status, "active");
  send(m, "Stop", 2);
  const stopped = sessionAt(m, 3);
  assert.equal(stopped.status, "idle");
  assert.equal(stopped.activity.phase, "waiting_input");
  send(m, "UserPromptSubmit", 10);
  const again = sessionAt(m, 11);
  assert.equal(again.status, "active");
  assert.equal(again.activity.phase, "requesting");
});

test("SessionEnd ends the session", () => {
  const m = new Monitor({}, new Bus());
  send(m, "SessionStart", 0);
  send(m, "SessionEnd", 1);
  const s = sessionAt(m, 2);
  assert.equal(s.status, "ended");
  assert.equal(s.activity.phase, "ended");
});

test("a permission prompt is shown as needing input", () => {
  const m = new Monitor({}, new Bus());
  send(m, "UserPromptSubmit", 0);
  send(m, "PreToolUse", 1, { tool_name: "Bash", tool_use_id: "t1" });
  send(m, "Notification", 2, { notification_type: "permission_prompt" });
  const s = sessionAt(m, 120);
  assert.equal(s.activity.phase, "waiting_permission");
  assert.equal(s.status, "idle");
});

test("compaction shows as its own phase", () => {
  const m = new Monitor({}, new Bus());
  send(m, "UserPromptSubmit", 0);
  send(m, "PreCompact", 1);
  assert.equal(sessionAt(m, 2).activity.phase, "compacting");
  send(m, "PostCompact", 3);
  assert.equal(sessionAt(m, 4).activity.phase, "requesting");
});

test("a Post that overtakes its Pre does not leave a stuck tool", () => {
  const m = new Monitor({}, new Bus());
  send(m, "PostToolUse", 1, { tool_name: "Read", tool_use_id: "t1" });
  send(m, "PreToolUse", 1, { tool_name: "Read", tool_use_id: "t1" });
  assert.equal(m.sessions.get("s")!.session.activity.tool, undefined);
});

test("a subagent's tools do not become the session's tool, but mark the agent running", () => {
  const m = new Monitor({}, new Bus());
  send(m, "UserPromptSubmit", 0);
  send(m, "PreToolUse", 1, { tool_name: "Read", tool_use_id: "t1", agent_id: "a1" });
  const s = sessionAt(m, 2);
  assert.equal(s.activity.tool, undefined);
  assert.deepEqual(s.activity.agents, ["a1"]);
  send(m, "SubagentStop", 3, { agent_id: "a1" });
  assert.deepEqual(sessionAt(m, 4).activity.agents, []);
});

test("a tool whose Post was lost expires", () => {
  const m = new Monitor({}, new Bus());
  send(m, "PreToolUse", 0, { tool_name: "Bash", tool_use_id: "t1" });
  m.tick(at(0).getTime() + 16 * 60_000);
  assert.equal(m.sessions.get("s")!.session.activity.tool, undefined);
});

test("a late transcript line does not undo a Stop", () => {
  const m = new Monitor({}, new Bus());
  send(m, "UserPromptSubmit", 0);
  send(m, "Stop", 10);
  m.ingestLines(
    [{ sessionId: "s", ts: at(9).toISOString(), events: [{ id: "x", sessionId: "s", ts: at(9).toISOString(), kind: "assistant", summary: "done" }] }],
    at(10).getTime(),
  );
  assert.equal(sessionAt(m, 11).activity.phase, "waiting_input");
});

test("activity changes are emitted on the bus", () => {
  const bus = new Bus();
  const phases: string[] = [];
  bus.on("activity_changed", (e) => phases.push(e.activity.phase));
  const m = new Monitor({}, bus);
  send(m, "UserPromptSubmit", 0);
  send(m, "PreToolUse", 1, { tool_name: "Read", tool_use_id: "t1" });
  send(m, "PostToolUse", 2, { tool_name: "Read", tool_use_id: "t1" });
  send(m, "Stop", 3);
  assert.deepEqual(phases, ["requesting", "tool", "requesting", "waiting_input"]);
});
