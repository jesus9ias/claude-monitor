import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import type { ProcessInfo, SessionDetail, StatsRange } from "@claude-monitor/shared";
import { gitInfo, GitTimeoutError } from "./git.js";
import { buildGraph } from "./graph.js";
import { parseHook } from "./hooks.js";
import type { SseHub } from "./sse.js";
import type { HookUpdate, Store } from "./store.js";

const WEB_DIST = fileURLToPath(new URL("../../web/dist", import.meta.url));
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
  store: Store;
  sse: SseHub;
  onHook: (hook: HookUpdate) => void;
  processes: () => ProcessInfo[];
}

export function buildApp({ store, sse, onHook, processes }: AppDeps): FastifyInstance {
  const app = Fastify({ logger: false });

  // Transcripts may hold secrets. A web page can reach 127.0.0.1 from the browser, so reject requests
  // from a foreign Origin (CSRF on /event) or a foreign Host (DNS rebinding). No CORS headers, ever.
  app.addHook("onRequest", async (req, reply) => {
    const { origin, host } = req.headers;
    const hostOk = host !== undefined && LOCAL_HOSTNAMES.has(hostnameOf(host) ?? "");
    const originOk = origin === undefined || LOCAL_HOSTNAMES.has(hostnameOf(origin) ?? "");
    if (!hostOk || !originOk) return reply.code(403).send({ error: "forbidden" });
  });

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
    return buildGraph(state, store.sortedEvents(state), req.query.group !== "0");
  });

  app.get("/api/processes", async () => processes());

  app.get<{ Querystring: { range?: string } }>("/api/stats", async (req) => {
    const r = req.query.range;
    const range: StatsRange = r === "today" || r === "30d" ? r : "7d";
    return store.stats(range);
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
      if (hook) onHook(hook);
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
