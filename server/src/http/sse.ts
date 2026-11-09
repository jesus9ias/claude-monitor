import type { ServerResponse } from "node:http";
import type { FastifyReply } from "fastify";
import { PROTOCOL_VERSION, type StreamMessage } from "@claude-monitor/shared";
import type { Bus } from "../bus.js";

const HEARTBEAT_MS = 20_000;

const format = (message: StreamMessage): string => `event: ${message.type}\ndata: ${JSON.stringify(message)}\n\n`;

export class SseHub {
  private readonly clients = new Set<ServerResponse>();

  constructor() {
    setInterval(() => this.write(": ping\n\n"), HEARTBEAT_MS).unref();
  }

  add(reply: FastifyReply): void {
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    res.write(format({ type: "hello", version: PROTOCOL_VERSION }));
    this.clients.add(res);
    res.on("close", () => this.clients.delete(res));
  }

  broadcast(message: StreamMessage): void {
    if (this.clients.size === 0) return;
    this.write(format(message));
  }

  closeAll(): void {
    for (const res of this.clients) res.end();
    this.clients.clear();
  }

  private write(chunk: string): void {
    for (const res of this.clients) res.write(chunk);
  }
}

/** Domain events, as the stream messages the UI understands. */
export function bridge(bus: Bus, sse: SseHub): void {
  bus.on("events_added", (e) => {
    for (const event of e.events) sse.broadcast({ type: "event_added", event });
  });
  bus.on("session_changed", (e) => sse.broadcast({ type: "session_updated", session: e.session }));
  bus.on("activity_changed", (e) => sse.broadcast({ type: "activity_changed", sessionId: e.sessionId, activity: e.activity }));
  bus.on("processes_changed", (e) => sse.broadcast({ type: "process_changed", processes: e.processes }));
  bus.on("quota_changed", (e) => sse.broadcast({ type: "quota_updated", quota: e.quota }));
}
