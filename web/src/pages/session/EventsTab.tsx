import { useCallback, useEffect, useState } from "react";
import type { Event } from "@claude-monitor/shared";
import { api, subscribe } from "../../api";
import { formatTime, formatTokens } from "../../format";
import { useSessionContext } from "./SessionLayout";

function EventRow({ event }: { event: Event }) {
  const [open, setOpen] = useState(false);
  const hasDetail = Boolean(event.detail);
  return (
    <li className={`event ${event.isSidechain ? "sidechain" : ""}`}>
      <button className="event-line" onClick={() => setOpen((v) => !v)} disabled={!hasDetail} aria-expanded={hasDetail ? open : undefined}>
        <span className="event-time">{formatTime(event.ts)}</span>
        <span className={`tag tag-${event.kind}`}>{event.kind.replace("_", " ")}</span>
        {event.toolName && <span className="tool-name">{event.toolName}</span>}
        <span className={`event-summary ${event.isError ? "is-error" : ""}`}>
          {event.isError && "Error: "}
          {event.summary}
        </span>
        {event.usage && <span className="event-tokens">{formatTokens(event.usage.output)} out</span>}
      </button>
      {open && hasDetail && <pre className="event-detail">{event.detail}</pre>}
    </li>
  );
}

export function EventsTab() {
  const { session } = useSessionContext();
  const id = session.id;
  const [events, setEvents] = useState<Event[]>([]);
  const [nextBefore, setNextBefore] = useState<string | undefined>();
  const [showHooks, setShowHooks] = useState(false);

  const load = useCallback(() => {
    api
      .session(id)
      .then((d) => {
        setEvents(d.events);
        setNextBefore(d.nextBefore);
      })
      .catch(() => undefined);
  }, [id]);

  useEffect(() => {
    load();
    return subscribe((message) => {
      if (message.type !== "event_added" || message.event.sessionId !== id) return;
      setEvents((current) => (current.some((e) => e.id === message.event.id) ? current : [...current, message.event]));
    }, load);
  }, [id, load]);

  const loadOlder = (): void => {
    if (!nextBefore) return;
    api
      .session(id, nextBefore)
      .then((page) => {
        setEvents((current) => [...page.events, ...current]);
        setNextBefore(page.nextBefore);
      })
      .catch(() => undefined);
  };

  const visible = (showHooks ? events : events.filter((e) => e.kind !== "hook")).slice().reverse();

  return (
    <section className="card">
      <div className="chart-head">
        <h2>Events</h2>
        <label className="check">
          <input type="checkbox" checked={showHooks} onChange={(e) => setShowHooks(e.target.checked)} /> Show hook events
        </label>
      </div>
      <ul className="events">
        {visible.map((event) => (
          <EventRow key={event.id} event={event} />
        ))}
      </ul>
      {nextBefore && (
        <button className="ghost load-older" onClick={loadOlder}>
          Load older events
        </button>
      )}
    </section>
  );
}
