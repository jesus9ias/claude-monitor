import assert from "node:assert/strict";
import { test } from "node:test";
import type { Quota } from "@claude-monitor/shared";
import { Bus } from "../src/bus.js";
import { readConfig } from "../src/config.js";
import { QuotaService } from "../src/domain/quota.js";
import { parseRateLimitHeaders, parseUsageBody, type FetchFn } from "../src/infra/anthropic.js";
import { StateDb } from "../src/infra/db.js";
import { parseStatusline } from "../src/ingest/statusline.js";

const TOKEN = "sk-ant-oat01-test-only-not-real";

function fakeFetch(handler: (url: string, init: RequestInit) => Response): { fn: FetchFn; calls: { url: string; init: RequestInit }[] } {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init: init ?? {} });
    return handler(url, init ?? {});
  }) as FetchFn;
  return { fn, calls };
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

const service = (fetchFn: FetchFn, source: "auto" | "usage" | "probe" | "off" = "auto", bus = new Bus()) =>
  new QuotaService({ token: TOKEN, source, intervalMs: 300_000, probeModel: "m", bus, fetchFn });

// @sc-quota-usage-endpoint
test("usage endpoint: percentages and per-model weeks, token only in the auth header", async () => {
  const { fn, calls } = fakeFetch(() =>
    json(200, {
      five_hour: { utilization: 23.5, resets_at: "2026-01-01T05:00:00Z" },
      seven_day: { utilization: 41, resets_at: "2026-01-07T00:00:00Z" },
      seven_day_opus: { utilization: 10, resets_at: null },
      seven_day_sonnet: null,
    }),
  );
  const q = await service(fn).refresh();
  assert.equal(q.status, "ok");
  assert.equal(q.source, "usage");
  assert.equal(q.fiveHour?.usedPct, 23.5);
  assert.equal(q.sevenDay?.resetsAt, "2026-01-07T00:00:00Z");
  assert.deepEqual(Object.keys(q.sevenDayByModel ?? {}), ["Opus"]);
  assert.equal(calls[0]?.url, "https://api.anthropic.com/api/oauth/usage");
  assert.equal((calls[0]?.init.headers as Record<string, string>).authorization, `Bearer ${TOKEN}`);
  assert.ok(!JSON.stringify(q).includes(TOKEN));
});

// @sc-quota-auto-fallback
test("auto falls back to probe when the token lacks the profile scope", async () => {
  const { fn, calls } = fakeFetch((url) =>
    url.endsWith("/usage")
      ? json(403, { error: "scope" })
      : json(200, {}, { "anthropic-ratelimit-unified-5h-utilization": "0.25", "anthropic-ratelimit-unified-5h-reset": "1767243600", "anthropic-ratelimit-unified-7d-utilization": "0.5" }),
  );
  const s = service(fn);
  const q = await s.refresh();
  assert.equal(q.source, "probe");
  assert.equal(q.fiveHour?.usedPct, 25);
  assert.equal(q.fiveHour?.resetsAt, new Date(1767243600 * 1000).toISOString());
  assert.equal(q.sevenDay?.usedPct, 50);
  const probe = JSON.parse(String(calls[1]?.init.body));
  assert.equal(probe.max_tokens, 1);
  // Next refresh goes straight to probe.
  await s.refresh();
  assert.equal(calls[2]?.url, "https://api.anthropic.com/v1/messages");
});

// @sc-quota-probe-429
test("a 429 from the probe still yields a reading", async () => {
  const { fn } = fakeFetch(() => json(429, {}, { "anthropic-ratelimit-unified-5h-utilization": "1", "anthropic-ratelimit-unified-5h-reset": "1767243600" }));
  const q = await service(fn, "probe").refresh();
  assert.equal(q.status, "ok");
  assert.equal(q.fiveHour?.usedPct, 100);
});

// @sc-quota-error-keeps-last
test("failures keep the last reading, mark error, and never leak the token", async () => {
  let fail = false;
  const { fn } = fakeFetch(() => {
    if (fail) throw new TypeError(`fetch failed for Bearer ${TOKEN}`);
    return json(200, { five_hour: { utilization: 5, resets_at: null } });
  });
  const s = service(fn, "usage");
  await s.refresh();
  fail = true;
  const q = await s.refresh();
  assert.equal(q.status, "error");
  assert.equal(q.fiveHour?.usedPct, 5);
  assert.ok(!JSON.stringify(q).includes(TOKEN));
  assert.equal(q.error, "could not reach Anthropic");
});

// @sc-quota-not-configured
test("no token or source off: not configured and no network", async () => {
  const { fn, calls } = fakeFetch(() => json(200, {}));
  const none = new QuotaService({ source: "auto", intervalMs: 300_000, probeModel: "m", bus: new Bus(), fetchFn: fn });
  assert.equal(none.configured, false);
  assert.equal((await none.refresh()).status, "not_configured");
  assert.equal(service(fn, "off").configured, false);
  assert.equal(calls.length, 0);
});

// @sc-quota-statusline-feed
test("statusline feed updates the quota and emits it", () => {
  const bus = new Bus();
  const seen: Quota[] = [];
  bus.on("quota_changed", (e) => seen.push(e.quota));
  const s = new QuotaService({ source: "auto", intervalMs: 300_000, probeModel: "m", bus });
  const reading = parseStatusline({ model: { id: "x" }, rate_limits: { five_hour: { used_percentage: 12, resets_at: 1767243600 } } });
  assert.ok(reading);
  s.fromStatusline(reading);
  assert.equal(s.current().source, "statusline");
  assert.equal(seen[0]?.fiveHour?.usedPct, 12);
  assert.equal(parseStatusline({ model: {} }), null);
});

// @sc-statusline-junk-ignored
test("parsers ignore junk", () => {
  assert.deepEqual(parseUsageBody("nope"), { fiveHour: undefined, sevenDay: undefined, sevenDayByModel: undefined });
  assert.deepEqual(parseRateLimitHeaders(new Headers({ "anthropic-ratelimit-unified-5h-utilization": "abc" })), { fiveHour: undefined, sevenDay: undefined });
});

// @sc-config-quota-interval-clamp
test("config reads the quota settings and clamps the interval", () => {
  const c = readConfig({ CLAUDE_CODE_OAUTH_TOKEN: ` ${TOKEN} `, CLAUDE_MONITOR_QUOTA_SOURCE: "PROBE", CLAUDE_MONITOR_QUOTA_INTERVAL: "5" });
  assert.equal(c.quota.token, TOKEN);
  assert.equal(c.quota.source, "probe");
  assert.equal(c.quota.intervalMs, 60_000);
  assert.equal(readConfig({ CLAUDE_MONITOR_QUOTA_SOURCE: "weird" }).quota.source, "auto");
});

// @sc-db-restores-state
test("state db keeps activity and quota across restarts", () => {
  const db = new StateDb(":memory:");
  db.saveActivity([{ sessionId: "s", snapshot: { phase: "tool", since: "2026-01-01T00:00:00Z", source: "hook:PreToolUse", runningAgents: [], stoppedAgents: ["a"], stoppedAt: 5 } }]);
  assert.equal(db.loadActivity().get("s")?.phase, "tool");
  db.addQuotaSample({ status: "ok", source: "usage", fetchedAt: "2026-01-01T00:00:00Z", fiveHour: { usedPct: 10 } });
  db.addQuotaSample({ status: "ok", source: "usage", fetchedAt: "2026-01-01T01:00:00Z", fiveHour: { usedPct: 20 } });
  db.addQuotaSample({ status: "error", error: "x" });
  assert.equal(db.latestQuota()?.fiveHour?.usedPct, 20);
  assert.equal(db.quotaHistory("2026-01-01T00:30:00Z").length, 1);
  db.close();
});
