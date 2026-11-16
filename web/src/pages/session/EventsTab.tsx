import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { classifyTool, type Event, type EventKind } from "@claude-monitor/shared";
import { api, subscribe } from "../../api";
import { CATEGORY_ICON, Icon, type IconName } from "../../components/Icon";
import { formatDuration, formatTime, formatTokens } from "../../format";
import { CopyButton, useSessionContext } from "./SessionLayout";

type Filter = "all" | "assistant" | "tools" | "hooks" | "errors";
const FILTERS: { value: Filter; label: string; icon: IconName }[] = [
  { value: "all", label: "All", icon: "events" },
  { value: "assistant", label: "Assistant", icon: "model" },
  { value: "tools", label: "Tools", icon: "router" },
  { value: "hooks", label: "Hooks", icon: "hook" },
  { value: "errors", label: "Errors", icon: "warning" },
];

const TOOL_KINDS: ReadonlySet<EventKind> = new Set(["tool_use", "tool_result", "subagent_start", "subagent_stop"]);

/** Hooks are hidden unless the Hooks chip is picked. */
function matches(e: Event, filter: Filter): boolean {
  switch (filter) {
    case "all":
      return e.kind !== "hook";
    case "assistant":
      return e.kind === "assistant" || e.kind === "thinking";
    case "tools":
      return TOOL_KINDS.has(e.kind);
    case "hooks":
      return e.kind === "hook";
    case "errors":
      return Boolean(e.isError);
  }
}

const KIND_LABEL: Record<EventKind, string> = {
  user: "You",
  assistant: "Assistant",
  thinking: "Thinking",
  tool_use: "Tool",
  tool_result: "Result",
  subagent_start: "Subagent",
  subagent_stop: "Subagent done",
  hook: "Hook",
};

function kindIcon(e: Event): IconName {
  if (e.isError) return "warning";
  switch (e.kind) {
    case "tool_use":
      return e.toolName ? CATEGORY_ICON[classifyTool(e.toolName).category] : "other";
    case "tool_result":
      return "ok";
    case "assistant":
      return "output";
    case "thinking":
      return "model";
    case "hook":
      return "hook";
    case "subagent_start":
    case "subagent_stop":
      return "agent";
    case "user":
      return "you";
  }
}

const kindTone = (e: Event): string =>
  e.isError ? "tone-error" : e.kind === "tool_use" || e.kind === "tool_result" ? "tone-tool" : e.kind === "hook" ? "tone-hook" : e.kind === "user" ? "tone-user" : "tone-model";

function EventRow({ event, duration }: { event: Event; duration?: number }) {
  const [open, setOpen] = useState(false);
  const hasDetail = Boolean(event.detail);
  const meta = event.usage ? `${formatTokens(event.usage.output)} out` : duration !== undefined ? formatDuration(duration) : "";
  return (
    <li className={`ev ${event.isSidechain ? "sidechain" : ""} ${event.isError ? "is-error-row" : ""}`}>
      <span className="ev-time mono">{formatTime(event.ts)}</span>
      <span className={`ev-node ${kindTone(event)}`}>
        <Icon name={kindIcon(event)} size={14} />
      </span>
      <div className="ev-body">
        <button className="ev-line" onClick={() => setOpen((v) => !v)} disabled={!hasDetail} aria-expanded={hasDetail ? open : undefined}>
          <span className={`ev-kind ${kindTone(event)}`}>{event.isError ? "Error" : KIND_LABEL[event.kind]}</span>
          {event.toolName && <span className="ev-tool mono">{event.toolName}</span>}
          {event.isSidechain && event.agentId && <span className="chip ev-agent">agent {event.agentId.slice(0, 6)}</span>}
          <span className="ev-summary">{event.summary}</span>
          {meta && <span className="ev-meta">{meta}</span>}
          {hasDetail && (
            <span className={open ? "chevron open" : "chevron"}>
              <Icon name="chevronRight" size={14} />
            </span>
          )}
        </button>
        {open && hasDetail && (
          <div className="ev-detail">
            <div className="ev-detail-head">
              <span className="muted small">Truncated by the parser</span>
              <CopyButton text={event.detail ?? ""} label="Copy detail" />
            </div>
            <pre className="mono">{event.detail}</pre>
          </div>
        )}
      </div>
    </li>
  );
}

interface Turn {
  user?: Event;
  events: Event[];
}

/** Splits oldest-first events at each user prompt; returns turns newest first, events newest first. */
function toTurns(events: Event[]): Turn[] {
  const turns: Turn[] = [];
  let current: Turn = { events: [] };
  for (const e of events) {
    if (e.kind === "user" && !e.isSidechain) {
      if (current.user || current.events.length) turns.push(current);
      current = { user: e, events: [] };
    } else {
      current.events.push(e);
    }
  }
  if (current.user || current.events.length) turns.push(current);
  return turns.reverse().map((t) => ({ ...t, events: t.events.slice().reverse() }));
}

export function EventsTab() {
  const { session } = useSessionContext();
  const id = session.id;
  const [events, setEvents] = useState<Event[]>([]);
  const [nextBefore, setNextBefore] = useState<string | undefined>();
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [following, setFollowing] = useState(true);
  const [unseen, setUnseen] = useState(0);
  const topRef = useRef<HTMLDivElement>(null);
  const followingRef = useRef(true);
  followingRef.current = following;

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
      setEvents((current) => {
        if (current.some((e) => e.id === message.event.id)) return current;
        if (!followingRef.current) setUnseen((n) => n + 1);
        return [...current, message.event];
      });
    }, load);
  }, [id, load]);

  // "Following live" while the newest event (the top of the list) is in view.
  useEffect(() => {
    const el = topRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => {
      const inView = Boolean(entry?.isIntersecting);
      setFollowing(inView);
      if (inView) setUnseen(0);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

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

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: 0, assistant: 0, tools: 0, hooks: 0, errors: 0 };
    for (const e of events) for (const f of FILTERS) if (matches(e, f.value)) c[f.value]++;
    return c;
  }, [events]);

  // Tool durations: from each call to its result.
  const durations = useMemo(() => {
    const started = new Map<string, number>();
    const out = new Map<string, number>();
    for (const e of events) {
      if (!e.toolUseId) continue;
      if (e.kind === "tool_use") started.set(e.toolUseId, Date.parse(e.ts));
      else if (e.kind === "tool_result") {
        const start = started.get(e.toolUseId);
        if (start !== undefined) out.set(e.id, Date.parse(e.ts) - start);
      }
    }
    return out;
  }, [events]);

  const turns = useMemo(() => {
    const q = query.trim().toLowerCase();
    const keep = (e: Event) => matches(e, filter) && (!q || (e.toolName ?? "").toLowerCase().includes(q) || e.summary.toLowerCase().includes(q));
    return toTurns(events)
      .map((t) => ({
        ...t,
        all: t.events,
        events: t.events.filter(keep),
      }))
      .filter((t) => t.events.length > 0 || (!q && filter === "all" && t.user));
  }, [events, filter, query]);

  const jumpToLatest = () => topRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });

  return (
    <section className="card events-card">
      <div className="events-tools">
        <label className="search well">
          <Icon name="search" />
          <span className="sr-only">Search events</span>
          <input type="search" placeholder="Search tool name or summary" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        {following ? (
          <span className="chip chip-good">
            <span className="dot dot-live" aria-hidden="true" />
            Following live
          </span>
        ) : (
          <span className="chip">Paused while you read</span>
        )}
      </div>
      <div className="chips" role="group" aria-label="Filter by event kind">
        {FILTERS.map((f) => (
          <button key={f.value} className="fchip" aria-pressed={filter === f.value} onClick={() => setFilter(f.value)}>
            <Icon name={f.icon} size={14} />
            {f.label}
            <span className="muted">{counts[f.value]}</span>
          </button>
        ))}
      </div>
      <p className="note">Search and counts cover the {events.length} loaded events.</p>

      <div ref={topRef} className="events-top" aria-hidden="true" />
      {turns.length === 0 && <p className="empty">No events match.</p>}
      <div className="timeline">
        {turns.map((t, i) => {
          const tools = t.all.filter((e) => e.kind === "tool_use").length;
          const errors = t.all.filter((e) => e.isError).length;
          return (
            <div key={t.user?.id ?? `t${i}`} className="turn">
              {t.user && (
                <div className="turn-sep">
                  <span className="chip chip-accent turn-chip">
                    <Icon name="you" size={14} />
                    You · {formatTime(t.user.ts)}
                  </span>
                  <span className="turn-prompt">{t.user.summary}</span>
                  <span className="muted small turn-meta">
                    {tools} {tools === 1 ? "tool call" : "tool calls"}
                    {errors > 0 && ` · ${errors} ${errors === 1 ? "error" : "errors"}`}
                  </span>
                </div>
              )}
              <ul className="events">
                {t.events.map((event) => (
                  <EventRow key={event.id} event={event} duration={durations.get(event.id)} />
                ))}
              </ul>
            </div>
          );
        })}
      </div>
      {nextBefore && (
        <button className="btn load-older" onClick={loadOlder}>
          Load older events
        </button>
      )}
      {!following && (
        <button className="btn btn-primary jump-latest" onClick={jumpToLatest}>
          <Icon name="sortUp" size={16} />
          Jump to latest{unseen > 0 && ` · ${unseen} new`}
        </button>
      )}
    </section>
  );
}
