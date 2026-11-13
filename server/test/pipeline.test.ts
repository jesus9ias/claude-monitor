import assert from "node:assert/strict";
import { test } from "node:test";
import { dueAlerts, projectPace, type Event } from "@claude-monitor/shared";
import { Bus } from "../src/bus.js";
import { parseAlerts } from "../src/config.js";
import { Monitor } from "../src/domain/monitor.js";
import { buildPipeline, contextWindow, replaySteps } from "../src/domain/pipeline.js";
import { computeAttribution } from "../src/domain/stats.js";
import { parseLine } from "../src/ingest/transcript.js";

let clock = 0;
const ts = (s: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, s)).toISOString();
function event(kind: Event["kind"], fields: Partial<Event> = {}): Event {
  clock++;
  return { id: `e${clock}`, sessionId: "s", ts: ts(clock), kind, summary: `${kind} ${clock}`, ...fields };
}

function session(events: Event[]) {
  const m = new Monitor({ m: { input: 1, output: 1, cacheRead: 1, cacheCreate: 1 } }, new Bus());
  const state = m.sessions.ensure("s", events[0]!.ts);
  state.session.cwd = "/repo";
  m.ingestLines([{ sessionId: "s", events }], Date.parse(events[events.length - 1]!.ts) + 3_600_000);
  m.tick(Date.parse(events[events.length - 1]!.ts) + 3_600_000);
  return { m, state };
}

// @sc-pipeline-counts
test("calls are counted per category, per MCP server, and per subagent", () => {
  const { m, state } = session([
    event("user"),
    event("thinking"),
    event("tool_use", { toolName: "Read", toolUseId: "r1" }),
    event("tool_result", { toolUseId: "r1" }),
    event("tool_use", { toolName: "mcp__github__create_pr", toolUseId: "g1" }),
    event("tool_result", { toolUseId: "g1", isError: true }),
    event("tool_use", { toolName: "Grep", toolUseId: "x1", agentId: "a1" }),
    event("assistant"),
  ]);
  m.linkAgent("s", "a1", { agentType: "Explore" }, ts(0));
  const p = buildPipeline(state, m.sessions.sortedEvents(state), new Set());
  assert.equal(p.prompts, 1);
  assert.equal(p.model.thinkingBlocks, 1);
  assert.equal(p.model.textBlocks, 1);
  assert.equal(p.categories.read.calls, 1);
  assert.equal(p.categories.read.lastDurationMs, 1000);
  assert.equal(p.categories.mcp.errors, 1);
  assert.deepEqual(p.mcpServers, { github: { calls: 1, errors: 1 } });
  assert.equal(p.categories.search.recent[0]?.agentId, "a1");
  assert.equal(p.agents[0]?.type, "Explore");
  assert.equal(p.agents[0]?.toolCalls, 1);
});

// @sc-pipeline-context-window
test("context is the latest main message's prompt, and the window comes from the model", () => {
  const line = (uuid: string, id: string, at: number, input: number) =>
    JSON.stringify({
      type: "assistant",
      uuid,
      sessionId: "s",
      cwd: "/repo",
      timestamp: ts(at),
      message: { id, model: "m", usage: { input_tokens: input, output_tokens: 1, cache_read_input_tokens: 1000 }, content: [{ type: "text", text: "x" }] },
    });
  const m = new Monitor({}, new Bus());
  m.ingestLines([parseLine(line("u1", "m1", 1, 10))!, parseLine(line("u2", "m2", 2, 50))!]);
  m.ingestLines([parseLine(JSON.stringify({ type: "system", subtype: "compact_boundary", sessionId: "s", timestamp: ts(3) }))!]);
  const state = m.sessions.get("s")!;
  const p = buildPipeline(state, state.events, new Set());
  assert.equal(p.context.tokens, 1050);
  assert.equal(p.context.windowTokens, 200_000);
  assert.equal(p.context.compactions, 1);
  assert.equal(contextWindow("m", 300_000), 1_000_000);
  assert.equal(contextWindow("claude-opus-5-5", 0), 1_000_000);
  assert.equal(contextWindow("claude-opus-5-5-20261101", 0), 1_000_000);
  assert.equal(contextWindow("m", 150_000), 200_000);
});

// @sc-pipeline-replay-last-turn
test("replay covers only the last turn, and ends waiting", () => {
  const steps = replaySteps([
    event("user"),
    event("assistant"),
    event("user"),
    event("thinking"),
    event("tool_use", { toolName: "mcp__x__y", toolUseId: "t" }),
    event("tool_use", { toolName: "Read", toolUseId: "sub", agentId: "a" }),
    event("tool_result", { toolUseId: "t" }),
    event("assistant"),
    event("assistant"),
  ]);
  assert.deepEqual(
    steps.map((s) => s.phase),
    ["requesting", "thinking", "tool", "requesting", "writing", "waiting_input"],
  );
  assert.equal(steps[2]?.tool?.mcpServer, "x");
});

// @sc-quota-pace
test("pace: rate from readings after the last reset, exhaustion vs reset", () => {
  const now = Date.UTC(2026, 0, 1, 2);
  const at = (minAgo: number, v: number) => ({ ts: new Date(now - minAgo * 60_000).toISOString(), usedPct: v });
  const samples = [at(200, 90), at(60, 10), at(30, 20), at(0, 30)];
  const pace = projectPace(samples, { usedPct: 30, resetsAt: new Date(now + 3 * 3_600_000).toISOString() }, now, 5 * 3_600_000);
  assert.ok(pace);
  assert.ok(Math.abs(pace.ratePctPerHour - 20) < 0.01);
  assert.equal(pace.exhaustAt, new Date(now + 3.5 * 3_600_000).toISOString());
  assert.equal(pace.beforeReset, false);
  assert.equal(projectPace([at(0, 30)], { usedPct: 30 }, now, 3_600_000), undefined);
  assert.equal(projectPace([at(30, 30), at(0, 30)], { usedPct: 30 }, now, 3_600_000)?.exhaustAt, undefined);
});

// @sc-quota-attribution
test("attribution weighs sessions by cost since the window start", () => {
  const m = new Monitor({ m: { input: 1, output: 1, cacheRead: 0, cacheCreate: 0 } }, new Bus());
  const line = (session: string, uuid: string, at: number, output: number) =>
    parseLine(
      JSON.stringify({
        type: "assistant",
        uuid,
        sessionId: session,
        cwd: `/${session}`,
        timestamp: ts(at),
        message: { id: uuid, model: "m", usage: { input_tokens: 0, output_tokens: output }, content: [{ type: "text", text: "x" }] },
      }),
    )!;
  m.ingestLines([line("old", "o1", 1, 1_000_000), line("a", "a1", 10, 100), line("b", "b1", 11, 300)]);
  const rows = computeAttribution(m.sessions, Date.parse(ts(5)));
  assert.deepEqual(
    rows.map((r) => [r.sessionId, r.outputTokens]),
    [
      ["b", 300],
      ["a", 100],
    ],
  );
});

// @sc-quota-alert-thresholds
test("alert thresholds parse, dedupe and sort", () => {
  assert.deepEqual(parseAlerts(undefined), [20, 5]);
  assert.deepEqual(parseAlerts("5, 20,20,150,x"), [20, 5]);
  assert.deepEqual(parseAlerts("off"), []);
  assert.deepEqual(parseAlerts(""), []);
});

// @sc-quota-alert-once-per-window
test("quota alerts: lowest crossed threshold, once per window reset", () => {
  const quota = { status: "ok" as const, fiveHour: { usedPct: 96, resetsAt: "2026-01-01T05:00:00Z" }, sevenDay: { usedPct: 50 } };
  const due = dueAlerts(quota, [20, 5], new Set());
  assert.deepEqual(
    due.map((d) => d.key),
    ["5h:2026-01-01T05:00:00Z:5"],
  );
  assert.equal(dueAlerts(quota, [20, 5], new Set(due.map((d) => d.key))).length, 0);
  assert.equal(dueAlerts(quota, [], new Set()).length, 0);
});
