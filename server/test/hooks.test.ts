import assert from "node:assert/strict";
import { test } from "node:test";
import { parseHook } from "../src/hooks.js";
import { Store } from "../src/store.js";

const at = (seconds: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, seconds));

function send(store: Store, name: string, seconds: number, extra: object = {}): void {
  const hook = parseHook({ session_id: "s", cwd: "/repo", hook_event_name: name, ...extra }, at(seconds));
  assert.ok(hook);
  store.applyHook(hook);
}

const statusAt = (store: Store, seconds: number) => {
  store.refreshStatuses(at(seconds).getTime());
  return store.get("s")?.session;
};

test("invalid bodies are ignored and unknown events kept", () => {
  for (const bad of [null, 1, "x", {}, { session_id: "s" }]) assert.equal(parseHook(bad), null);
  assert.equal(parseHook({ session_id: "s", hook_event_name: "Whatever" })?.effect, "none");
});

test("hook payload content never reaches an event", () => {
  const hook = parseHook({
    session_id: "s",
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_input: { command: "export TOKEN=secret" },
  });
  assert.ok(!JSON.stringify(hook).includes("secret"));
});

test("a tool flips active with the current tool, and Post clears it", () => {
  const store = new Store({});
  send(store, "SessionStart", 0);
  send(store, "PreToolUse", 1, { tool_name: "Bash", tool_use_id: "t1" });
  assert.equal(statusAt(store, 200)?.status, "active"); // Long tool: past the 30s heuristic.
  assert.equal(store.get("s")?.session.current?.toolName, "Bash");
  send(store, "PostToolUse", 201, { tool_name: "Bash", tool_use_id: "t1" });
  assert.equal(store.get("s")?.session.current, undefined);
});

test("Stop flips to idle at once, and a new prompt reactivates", () => {
  const store = new Store({});
  send(store, "SessionStart", 0);
  assert.equal(statusAt(store, 1)?.status, "active");
  send(store, "Stop", 2);
  assert.equal(statusAt(store, 3)?.status, "idle");
  send(store, "UserPromptSubmit", 10);
  assert.equal(statusAt(store, 11)?.status, "active");
});

test("SessionEnd ends the session", () => {
  const store = new Store({});
  send(store, "SessionStart", 0);
  send(store, "SessionEnd", 1);
  assert.equal(statusAt(store, 2)?.status, "ended");
});

test("a Post that overtakes its Pre does not leave a stuck tool", () => {
  const store = new Store({});
  send(store, "PostToolUse", 1, { tool_name: "Read", tool_use_id: "t1" });
  send(store, "PreToolUse", 1, { tool_name: "Read", tool_use_id: "t1" });
  assert.equal(store.get("s")?.session.current, undefined);
});

test("a subagent's tools do not become the session's current tool", () => {
  const store = new Store({});
  send(store, "PreToolUse", 1, { tool_name: "Read", tool_use_id: "t1", agent_id: "a1" });
  assert.equal(store.get("s")?.session.current, undefined);
});

test("a tool whose Post was lost expires", () => {
  const store = new Store({});
  send(store, "PreToolUse", 0, { tool_name: "Bash", tool_use_id: "t1" });
  store.refreshStatuses(at(0).getTime() + 16 * 60_000);
  assert.equal(store.get("s")?.session.current, undefined);
});
