import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { Event, Session, UsagePoint } from "@claude-monitor/shared";
import { api, subscribe } from "../api";
import { CurrentTool, StatusBadge, Tile } from "../components/common";
import { GitPanel } from "../components/GitPanel";
import { TokenCharts } from "../components/TokenCharts";
import { formatCost, formatInt, formatTime, formatTokens, projectName, useNow } from "../format";

const SERIES_REFRESH_MS = 2000;

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

export function SessionDetailPage() {
  const { id = "" } = useParams();
  const [session, setSession] = useState<Session | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [series, setSeries] = useState<UsagePoint[]>([]);
  const [nextBefore, setNextBefore] = useState<string | undefined>();
  const [missing, setMissing] = useState(false);
  const [showHooks, setShowHooks] = useState(false);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const now = useNow();

  const load = useCallback(() => {
    api
      .session(id)
      .then((detail) => {
        setSession(detail.session);
        setEvents(detail.events);
        setSeries(detail.usageSeries);
        setNextBefore(detail.nextBefore);
        setMissing(false);
      })
      .catch(() => setMissing(true));
  }, [id]);

  useEffect(() => {
    load();
    return subscribe((message) => {
      if (message.type === "session_updated" && message.session.id === id) {
        setSession(message.session);
        // Usage on existing messages can change, so refresh the series rather than patching it.
        refreshTimer.current ??= setTimeout(() => {
          refreshTimer.current = null;
          api.session(id).then((d) => setSeries(d.usageSeries)).catch(() => undefined);
        }, SERIES_REFRESH_MS);
      } else if (message.type === "event_added" && message.event.sessionId === id) {
        setEvents((current) => (current.some((e) => e.id === message.event.id) ? current : [...current, message.event]));
      }
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

  if (missing) {
    return (
      <p className="empty">
        Session not found. <Link to="/">Back to sessions</Link>
      </p>
    );
  }
  if (!session) return <p className="empty">Loading…</p>;

  const visible = (showHooks ? events : events.filter((e) => e.kind !== "hook")).slice().reverse();

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{session.title ?? projectName(session.cwd)}</h1>
          <div className="muted">
            {session.cwd}
            {session.gitBranch && ` · ${session.gitBranch}`}
            {session.model && ` · ${session.model}`}
            {session.pid !== undefined && ` · pid ${session.pid}`}
          </div>
        </div>
        <div className="head-status">
          <StatusBadge status={session.status} />
          <CurrentTool current={session.current} now={now} />
          <Link className="flow-link" to={`/sessions/${session.id}/flow`}>
            View flow
          </Link>
        </div>
      </div>

      <section className="tiles">
        <Tile label="Estimated cost" value={formatCost(session.costUsd)} />
        <Tile label="Input" value={formatTokens(session.usage.input)} />
        <Tile label="Output" value={formatTokens(session.usage.output)} />
        <Tile label="Cache read" value={formatTokens(session.usage.cacheRead)} />
        <Tile label="Cache write" value={formatTokens(session.usage.cacheCreate)} />
        <Tile label="Subagents" value={String(session.subagents.length)} />
      </section>

      <section className="card">
        <h2>Tokens over time</h2>
        <TokenCharts series={series} />
      </section>

      <section className="card">
        <h2>Git</h2>
        <GitPanel sessionId={session.id} />
      </section>

      <section className="card">
        <h2>Usage by model</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Model</th>
                <th className="num">Input</th>
                <th className="num">Output</th>
                <th className="num">Cache read</th>
                <th className="num">Cache write</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(session.usageByModel).map(([model, u]) => (
                <tr key={model}>
                  <td>{model}</td>
                  <td className="num">{formatInt(u.input)}</td>
                  <td className="num">{formatInt(u.output)}</td>
                  <td className="num">{formatInt(u.cacheRead)}</td>
                  <td className="num">{formatInt(u.cacheCreate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

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
    </>
  );
}
