import assert from "node:assert/strict";
import { test } from "node:test";
import type { Event, Graph } from "@claude-monitor/shared";
import { Bus } from "../src/bus.js";
import { buildGraph } from "../src/domain/graph.js";
import { Monitor } from "../src/domain/monitor.js";

let clock = 0;
function event(kind: Event["kind"], fields: Partial<Event> = {}): Event {
  clock++;
  return {
    id: `e${clock}`,
    sessionId: "s",
    ts: new Date(Date.UTC(2026, 0, 1, 0, 0, clock)).toISOString(),
    kind,
    summary: `${kind} ${clock}`,
    ...fields,
  };
}

function build(events: Event[], configure?: (m: Monitor) => void, group = true): Graph {
  const m = new Monitor({}, new Bus());
  const state = m.sessions.ensure("s", events[0]!.ts);
  state.session.cwd = "/repo";
  configure?.(m);
  const end = Date.parse(events[events.length - 1]!.ts) + 3_600_000;
  m.ingestLines([{ sessionId: "s", events }], end);
  m.tick(end);
  return buildGraph(state, m.sessions.sortedEvents(state), group);
}

const tool = (id: string, name = "Read") => event("tool_use", { toolName: name, toolUseId: id });
const result = (id: string, isError?: boolean) => event("tool_result", { toolUseId: id, isError });
const events0 = () => new Date(Date.UTC(2026, 0, 1)).toISOString();
const byType = (g: Graph, type: string) => g.nodes.filter((n) => n.type === type);
const parentOf = (g: Graph, id: string) => g.edges.find((e) => e.target === id)?.source;

test("turns chain from the session, and tools hang from their turn", () => {
  const g = build([event("user"), tool("t1"), result("t1"), event("user"), tool("t2", "Bash"), result("t2", true)]);
  const [t1, t2] = byType(g, "turn");
  assert.equal(parentOf(g, t1!.id), "session");
  assert.equal(parentOf(g, t2!.id), t1!.id);
  const [read, bash] = byType(g, "tool");
  assert.equal(read?.data.container, t1!.id);
  assert.equal(read?.data.status, "ok");
  assert.equal(read?.data.durationMs, 1000);
  assert.equal(bash?.data.container, t2!.id);
  assert.equal(bash?.data.status, "error");
  assert.equal(t2?.data.status, "error");
});

test("an Agent call becomes a subagent node that owns the sidechain's tools", () => {
  const g = build(
    [
      event("user"),
      tool("agent1", "Agent"),
      event("assistant", { agentId: "a1", isSidechain: true, model: "haiku", usage: { input: 5, output: 7, cacheRead: 0, cacheCreate: 0, cacheCreate1h: 0 } }),
      event("tool_use", { agentId: "a1", isSidechain: true, toolName: "Grep", toolUseId: "g1" }),
      event("tool_result", { agentId: "a1", isSidechain: true, toolUseId: "g1" }),
      result("agent1"),
    ],
    (m) => m.linkAgent("s", "a1", { toolUseId: "agent1", agentType: "Explore", description: "Find things" }, events0()),
  );
  const [agent] = byType(g, "subagent");
  assert.equal(agent?.data.label, "Explore");
  assert.equal(agent?.data.model, "haiku");
  assert.equal(agent?.data.tokens, 12);
  assert.equal(parentOf(g, agent!.id), byType(g, "turn")[0]!.id);
  const tools = byType(g, "tool");
  assert.deepEqual(tools.map((t) => t.data.label), ["Grep"]);
  assert.equal(tools[0]?.data.container, agent!.id);
});

test("an agent with no known parent call hangs from the session", () => {
  const g = build([event("user"), event("tool_use", { agentId: "lost", toolName: "Read", toolUseId: "x" })]);
  assert.equal(parentOf(g, "agent:lost"), "session");
});

test("more than 8 calls in a turn fold repeated tools, unless grouping is off", () => {
  const events: Event[] = [event("user")];
  for (let i = 0; i < 12; i++) events.push(tool(`r${i}`), result(`r${i}`));
  events.push(tool("b1", "Bash"), result("b1"));

  const grouped = build(events);
  assert.equal(byType(grouped, "group")[0]?.data.label, "12 x Read");
  assert.equal(byType(grouped, "group")[0]?.data.items?.length, 12);
  assert.deepEqual(byType(grouped, "tool").map((t) => t.data.label), ["Bash"]);

  assert.equal(byType(build(events, undefined, false), "tool").length, 13);
});

test("8 calls or fewer stay individual", () => {
  const events: Event[] = [event("user")];
  for (let i = 0; i < 8; i++) events.push(tool(`r${i}`), result(`r${i}`));
  assert.equal(byType(build(events), "group").length, 0);
});

test("an unanswered tool is running only while the session is active", () => {
  const m = new Monitor({}, new Bus());
  const e = [event("user"), tool("t1")];
  const state = m.sessions.ensure("s", e[0]!.ts);
  state.session.cwd = "/repo";
  m.ingestLines([{ sessionId: "s", events: e }], Date.parse(e[1]!.ts));

  m.tick(Date.parse(e[1]!.ts) + 1000);
  assert.equal(byType(buildGraph(state, state.events, true), "tool")[0]?.data.status, "running");

  m.tick(Date.parse(e[1]!.ts) + 3_600_000);
  assert.equal(byType(buildGraph(state, state.events, true), "tool")[0]?.data.status, undefined);
});

test("every edge joins existing nodes", () => {
  const g = build([event("user"), tool("t1"), event("tool_use", { agentId: "a", toolName: "Read", toolUseId: "z" })]);
  const ids = new Set(g.nodes.map((n) => n.id));
  for (const e of g.edges) assert.ok(ids.has(e.source) && ids.has(e.target), e.id);
});
