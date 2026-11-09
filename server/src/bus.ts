/**
 * In-process domain events. Producers (monitor, process poller, quota service) emit; consumers
 * (SSE bridge, persistence) subscribe. Nothing here knows about HTTP.
 */
import type { Activity, Event, ProcessInfo, Quota, Session } from "@claude-monitor/shared";

export type DomainEvent =
  | { type: "events_added"; sessionId: string; events: Event[] }
  | { type: "session_changed"; session: Session }
  | { type: "activity_changed"; sessionId: string; activity: Activity }
  | { type: "processes_changed"; processes: ProcessInfo[] }
  | { type: "quota_changed"; quota: Quota };

type Handler<T extends DomainEvent["type"]> = (event: Extract<DomainEvent, { type: T }>) => void;

export class Bus {
  private readonly handlers = new Map<string, Set<(e: DomainEvent) => void>>();

  on<T extends DomainEvent["type"]>(type: T, handler: Handler<T>): () => void {
    const set = this.handlers.get(type) ?? new Set();
    set.add(handler as (e: DomainEvent) => void);
    this.handlers.set(type, set);
    return () => set.delete(handler as (e: DomainEvent) => void);
  }

  emit(event: DomainEvent): void {
    for (const handler of this.handlers.get(event.type) ?? []) {
      try {
        handler(event);
      } catch (err) {
        // One broken consumer must not stop the others, nor the ingest that emitted.
        console.error(`Handler for ${event.type} failed: ${err instanceof Error ? err.message : "unknown error"}`);
      }
    }
  }
}
