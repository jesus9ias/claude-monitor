import assert from "node:assert/strict";
import { appendFile, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { Bus } from "../src/bus.js";
import { Monitor } from "../src/domain/monitor.js";
import { messageCost, type PriceTable } from "../src/domain/pricing.js";
import { SessionStore } from "../src/domain/sessions.js";
import { Scanner } from "../src/ingest/scanner.js";
import { describeTranscript, parseLine } from "../src/ingest/transcript.js";

const prices: PriceTable = {
  m: { input: 1, output: 2, cacheRead: 0.1, cacheCreate: 1.25, cacheCreate1h: 2 },
  tiered: {
    input: 1,
    output: 1,
    cacheRead: 1,
    cacheCreate: 1,
    longPrompt: { overTokens: 100, input: 5, output: 5, cacheRead: 5, cacheCreate: 5 },
  },
  fast: { input: 1, output: 1, cacheRead: 1, cacheCreate: 1, fastMultiplier: 2 },
};

const usage = (input: number, output: number) => ({ input_tokens: input, output_tokens: output });

const assistant = (uuid: string, messageId: string, block: object, u: object = usage(10, 20), model = "m") =>
  JSON.stringify({
    type: "assistant",
    uuid,
    sessionId: "s1",
    cwd: "/repo",
    gitBranch: "main",
    timestamp: "2026-01-01T00:00:01.000Z",
    message: { id: messageId, model, usage: u, content: [block] },
  });

// @sc-transcript-malformed-line-skipped
test("malformed lines return null and never throw", () => {
  for (const bad of ["{nope", "", "null", "42", "[]", '{"type":"assistant"}', '{"type":"user","message":7}']) {
    assert.equal(parseLine(bad), null, bad);
  }
});

// @sc-transcript-usage-counted-once
test("usage repeated across a message's lines is counted once, with the latest value", () => {
  const store = new SessionStore(prices);
  for (const line of [
    assistant("u1", "msg1", { type: "thinking", thinking: "" }),
    assistant("u2", "msg1", { type: "text", text: "hi" }),
    assistant("u3", "msg1", { type: "tool_use", id: "t1", name: "Bash", input: { command: "ls" } }, usage(10, 50)),
  ]) {
    store.ingest(parseLine(line)!);
  }
  const { session } = store.get("s1")!;
  assert.equal(session.usage.input, 10);
  assert.equal(session.usage.output, 50);
  assert.equal(session.usageByModel.m?.output, 50);
  assert.equal(session.costUsd, (10 * 1 + 50 * 2) / 1e6);
});

// @sc-transcript-reingest-noop
test("re-ingesting the same line is a no-op", () => {
  const store = new SessionStore(prices);
  const line = assistant("u1", "msg1", { type: "text", text: "hi" });
  store.ingest(parseLine(line)!);
  const again = store.ingest(parseLine(line)!);
  assert.equal(again?.added.length, 0);
  assert.equal(store.get("s1")?.session.usage.output, 20);
});

// @sc-transcript-synthetic-no-usage
test("synthetic messages count no usage", () => {
  const store = new SessionStore(prices);
  store.ingest(parseLine(assistant("u1", "msg1", { type: "text", text: "err" }, usage(5, 5), "<synthetic>"))!);
  assert.equal(store.get("s1")?.session.usage.input, 0);
  assert.equal(store.get("s1")?.session.model, undefined);
});

// @sc-cost-unknown-model-null
test("unknown model makes the session cost null", () => {
  const store = new SessionStore(prices);
  store.ingest(parseLine(assistant("u1", "msg1", { type: "text", text: "a" }))!);
  store.ingest(parseLine(assistant("u2", "msg2", { type: "text", text: "b" }, usage(1, 1), "mystery"))!);
  assert.equal(store.get("s1")?.session.costUsd, null);
});

// @sc-cost-cache-tiers-fast-mode
test("cost separates 5m and 1h cache writes, and applies tiers and fast mode", () => {
  const base = { input: 0, output: 0, cacheRead: 0, cacheCreate: 0, cacheCreate1h: 0 };
  assert.equal(messageCost(prices, "m", { ...base, cacheCreate: 1_000_000, cacheCreate1h: 1_000_000 }), 2);
  assert.equal(messageCost(prices, "m", { ...base, cacheCreate: 1_000_000 }), 1.25);
  assert.equal(messageCost(prices, "m-20250101", { ...base, input: 1_000_000 }), 1);
  assert.equal(messageCost(prices, "tiered", { ...base, input: 101 }), (101 * 5) / 1e6);
  assert.equal(messageCost(prices, "fast", { ...base, input: 1_000_000 }, "fast"), 2);
  assert.equal(messageCost(prices, "nope", base), null);
});

// @sc-transcript-path-resolves
test("transcript paths resolve to a session and an agent", () => {
  const p = (...parts: string[]) => path.join("root", ...parts);
  assert.deepEqual(describeTranscript(p("proj", "abc.jsonl")), { sessionId: "abc" });
  assert.deepEqual(describeTranscript(p("proj", "abc", "subagents", "agent-x1.jsonl")), { sessionId: "abc", agentId: "x1" });
  assert.equal(describeTranscript(p("proj", "abc.txt")), null);
});

// @sc-scanner-incremental-read
test("scanner reads incrementally, holds back partial lines and survives garbage", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "monitor-"));
  const dir = path.join(root, "proj");
  await mkdir(dir);
  const file = path.join(dir, "s1.jsonl");
  const monitor = new Monitor(prices, new Bus());
  const store = monitor.sessions;
  const scanner = new Scanner(monitor);

  const line1 = assistant("u1", "msg1", { type: "text", text: "one" });
  const line2 = assistant("u2", "msg2", { type: "text", text: "two" });
  await writeFile(file, `${line1}\n{garbage\n${line2.slice(0, 20)}`);
  await scanner.readNew(file);
  assert.equal(store.get("s1")?.events.length, 1);
  assert.equal(scanner.malformedLines, 1);

  await appendFile(file, `${line2.slice(20)}\n`);
  await scanner.readNew(file);
  assert.equal(store.get("s1")?.events.length, 2);
  assert.equal(store.get("s1")?.session.usage.output, 40);
});

// @sc-transcript-thinking-event
test("thinking blocks are their own event kind", () => {
  const parsed = parseLine(assistant("u1", "msg1", { type: "thinking", thinking: "secret plan" }));
  assert.equal(parsed?.events[0]?.kind, "thinking");
  assert.ok(!JSON.stringify(parsed).includes("secret plan"));
});

// @sc-transcript-phase-markers
test("phase markers: api-request, compaction, turn end", () => {
  const ts = "2026-01-01T00:00:05.000Z";
  assert.deepEqual(parseLine(JSON.stringify({ type: "api-request", sessionId: "s1", timestamp: ts }))?.marker, { kind: "request" });
  assert.deepEqual(
    parseLine(JSON.stringify({ type: "system", subtype: "compact_boundary", sessionId: "s1", timestamp: ts, compactMetadata: { durationMs: 900 } }))?.marker,
    { kind: "compacted", durationMs: 900 },
  );
  assert.deepEqual(parseLine(JSON.stringify({ type: "system", subtype: "stop_hook_summary", sessionId: "s1", timestamp: ts }))?.marker, { kind: "turn_end" });
  assert.equal(parseLine(JSON.stringify({ type: "system", subtype: "something_new", sessionId: "s1", timestamp: ts })), null);
});

// @sc-transcript-entrypoint
test("entrypoint comes from the main transcript", () => {
  const line = JSON.parse(assistant("u1", "msg1", { type: "text", text: "hi" }));
  line.entrypoint = "claude-desktop";
  const store = new SessionStore(prices);
  store.ingest(parseLine(JSON.stringify(line))!);
  assert.equal(store.get("s1")?.session.entrypoint, "claude-desktop");
});
