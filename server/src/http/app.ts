import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import { PROTOCOL_VERSION, type ProcessInfo, type Quota, type QuotaSample, type ServerMeta, type SessionDetail, type StatsRange } from "@claude-monitor/shared";
import { buildGraph } from "../domain/graph.js";
import type { Monitor } from "../domain/monitor.js";
import { buildPipeline } from "../domain/pipeline.js";
import { computeAttribution, computeStats } from "../domain/stats.js";
import { gitInfo, GitTimeoutError } from "../infra/git.js";
import type { HookUpdate } from "../ingest/hooks.js";
import { parseHook } from "../ingest/hooks.js";
import { parseStatusline } from "../ingest/statusline.js";
import type { QuotaReading } from "../infra/anthropic.js";
import type { SseHub } from "./sse.js";

const WEB_DIST = fileURLToPath(new URL("../../../web/dist", import.meta.url));
/** Tool input can be a whole file. Only metadata is kept, but the body must still parse. */
const HOOK_BODY_LIMIT = 20 * 1024 * 1024;
const DEFAULT_PAGE = 200;
const MAX_PAGE = 1000;
const LOCAL_HOSTNAMES = new Set(["127.0.0.1", "localhost"]);

function hostnameOf(value: string): string | null {
  try {
    return new URL(value.includes("://") ? value : `http://${value}`).hostname;
  } catch {
    return null;
  }
}

export interface AppDeps {
  monitor: Monitor;
  sse: SseHub;
  processes: () => ProcessInfo[];
  quota: {
    current: () => Quota;
    configured: boolean;
    alerts: number[];
    refresh: () => Promise<Quota>;
    history: (sinceIso: string) => QuotaSample[];
    fromStatusline: (reading: QuotaReading) => void;
  };
  onHook?: (hook: HookUpdate) => void;
}

export function buildApp({ monitor, sse, processes, quota, onHook }: AppDeps): FastifyInstance {
  const app = Fastify({ logger: false });
  const store = monitor.sessions;

  // Transcripts may hold secrets. A web page can reach 127.0.0.1 from the browser, so reject requests
  // from a foreign Origin (CSRF on /event) or a foreign Host (DNS rebinding). No CORS headers, ever.
  app.addHook("onRequest", async (req, reply) => {
    const { origin, host } = req.headers;
    const hostOk = host !== undefined && LOCAL_HOSTNAMES.has(hostnameOf(host) ?? "");
    const originOk = origin === undefined || LOCAL_HOSTNAMES.has(hostnameOf(origin) ?? "");
    if (!hostOk || !originOk) return reply.code(403).send({ error: "forbidden" });
  });

  app.get("/api/meta", async (): Promise<ServerMeta> => ({
    protocolVersion: PROTOCOL_VERSION,
    quotaConfigured: quota.configured,
    quotaAlerts: quota.alerts,
  }));

  app.get("/api/sessions", async () => store.listSessions());

  app.get<{ Params: { id: string }; Querystring: { before?: string; limit?: string } }>(
    "/api/sessions/:id",
    async (req, reply): Promise<SessionDetail | undefined> => {
      const state = store.get(req.params.id);
      if (!state) {
        reply.code(404).send({ error: "session not found" });
        return undefined;
      }
      const events = store.sortedEvents(state);
      const limit = Math.min(Math.max(Number(req.query.limit) || DEFAULT_PAGE, 1), MAX_PAGE);
      let end = events.length;
      if (req.query.before) {
        const at = events.findIndex((e) => e.id === req.query.before);
        end = at === -1 ? 0 : at;
      }
      const start = Math.max(0, end - limit);
      return {
        session: state.session,
        events: events.slice(start, end),
        nextBefore: start > 0 ? events[start]?.id : undefined,
        usageSeries: store.usageSeries(state),
      };
    },
  );

  app.get<{ Params: { id: string } }>("/api/sessions/:id/git", async (req, reply) => {
    const state = store.get(req.params.id);
    if (!state?.session.cwd) return reply.code(404).send({ error: "session not found" });
    try {
      return await gitInfo(state.session.cwd);
    } catch (err) {
      const timedOut = err instanceof GitTimeoutError;
      return reply.code(timedOut ? 504 : 500).send({ error: timedOut ? "git timed out" : "git failed" });
    }
  });

  app.get<{ Params: { id: string }; Querystring: { group?: string } }>("/api/sessions/:id/graph", async (req, reply) => {
    const state = store.get(req.params.id);
    if (!state) return reply.code(404).send({ error: "session not found" });
    const stopped = monitor.activity.get(state.session.id)?.stoppedAgents;
    return buildGraph(state, store.sortedEvents(state), req.query.group !== "0", stopped);
  });

  app.get<{ Params: { id: string } }>("/api/sessions/:id/pipeline", async (req, reply) => {
    const state = store.get(req.params.id);
    if (!state) return reply.code(404).send({ error: "session not found" });
    return buildPipeline(state, store.sortedEvents(state), new Set(state.session.activity.agents));
  });

  app.get("/api/processes", async () => processes());

  app.get<{ Querystring: { range?: string } }>("/api/stats", async (req) => {
    const r = req.query.range;
    const range: StatsRange = r === "today" || r === "30d" ? r : "7d";
    return computeStats(store, range);
  });

  app.get("/api/quota", async () => quota.current());

  app.get<{ Querystring: { days?: string } }>("/api/quota/history", async (req) => {
    const days = Math.min(Math.max(Number(req.query.days) || 7, 1), 90);
    return quota.history(new Date(Date.now() - days * 86_400_000).toISOString());
  });

  app.get<{ Querystring: { since?: string } }>("/api/quota/attribution", async (req, reply) => {
    const since = Date.parse(req.query.since ?? "");
    if (!Number.isFinite(since)) return reply.code(400).send({ error: "since must be an ISO date" });
    return computeAttribution(store, since);
  });

  app.post("/api/quota/refresh", async (_req, reply) => {
    if (!quota.configured) return reply.code(409).send({ error: "quota is not configured" });
    return quota.refresh();
  });

  app.get("/stream", (_req, reply) => sse.add(reply));

  // Answer first and process after, so a hook is never held up by this server.
  app.post("/event", { bodyLimit: HOOK_BODY_LIMIT }, async (req, reply) => {
    if (!req.headers["content-type"]?.startsWith("application/json")) {
      return reply.code(415).send({ error: "expected application/json" });
    }
    reply.code(204).send();
    setImmediate(() => {
      const hook = parseHook(req.body);
      if (!hook) return;
      monitor.applyHook(hook);
      onHook?.(hook);
    });
    return reply;
  });

  // The statusline command posts Claude Code's statusline JSON here. Same rules as /event.
  app.post("/statusline", { bodyLimit: 1024 * 1024 }, async (req, reply) => {
    if (!req.headers["content-type"]?.startsWith("application/json")) {
      return reply.code(415).send({ error: "expected application/json" });
    }
    reply.code(204).send();
    setImmediate(() => {
      const reading = parseStatusline(req.body);
      if (reading) quota.fromStatusline(reading);
    });
    return reply;
  });

  if (existsSync(WEB_DIST)) {
    app.register(fastifyStatic, { root: WEB_DIST });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === "GET" && !req.url.startsWith("/api/")) return reply.sendFile("index.html");
      return reply.code(404).send({ error: "not found" });
    });
  }
  return app;
}
