import type { ServerResponse } from "node:http";
import type { FastifyReply } from "fastify";
import type { StreamMessage } from "@claude-monitor/shared";

const HEARTBEAT_MS = 20_000;

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
    res.write(": connected\n\n");
    this.clients.add(res);
    res.on("close", () => this.clients.delete(res));
  }

  broadcast(message: StreamMessage): void {
    if (this.clients.size === 0) return;
    this.write(`event: ${message.type}\ndata: ${JSON.stringify(message)}\n\n`);
  }

  closeAll(): void {
    for (const res of this.clients) res.end();
    this.clients.clear();
  }

  private write(chunk: string): void {
    for (const res of this.clients) res.write(chunk);
  }
}
