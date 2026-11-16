import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useOutletContext, useParams } from "react-router-dom";
import type { Session } from "@claude-monitor/shared";
import { api, subscribe } from "../../api";
import { ActivityBadge, EmptyState, StatusBadge } from "../../components/common";
import { Icon, type IconName } from "../../components/Icon";
import { formatDateTime, projectName, useNow } from "../../format";
import { useSession } from "../../state/live";

export const SESSION_TABS: { path: string; label: string; icon: IconName }[] = [
  { path: "", label: "Overview", icon: "overview" },
  { path: "events", label: "Events", icon: "events" },
  { path: "flow", label: "Flow", icon: "flow" },
  { path: "pipeline", label: "Pipeline", icon: "router" },
];

export interface SessionContext {
  session: Session;
}

export const useSessionContext = (): SessionContext => useOutletContext<SessionContext>();

/** Copies text to the clipboard and says so for a moment. */
export function CopyButton({ text, label, compact = false }: { text: string; label: string; compact?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => undefined);
  };
  if (compact) {
    return (
      <button className="copy-mini" onClick={copy} aria-label={copied ? "Copied" : label} title={copied ? "Copied" : label}>
        <Icon name={copied ? "ok" : "copy"} size={14} />
      </button>
    );
  }
  return (
    <button className="ghost" onClick={copy} aria-label={copied ? "Copied" : label}>
      <Icon name={copied ? "ok" : "copy"} size={14} />
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

/** Events loaded so far for the tab count; "n+" while older pages exist. */
function useEventCount(id: string): string | null {
  const [count, setCount] = useState<{ n: number; more: boolean } | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = (): void => {
      api
        .session(id)
        .then((d) => !cancelled && setCount({ n: d.events.length, more: Boolean(d.nextBefore) }))
        .catch(() => undefined);
    };
    load();
    const unsubscribe = subscribe((message) => {
      if (message.type === "event_added" && message.event.sessionId === id) setCount((c) => (c ? { ...c, n: c.n + 1 } : c));
    }, load);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [id]);
  if (!count) return null;
  const n = new Intl.NumberFormat("en-US").format(count.n);
  return count.more ? `${n}+` : n;
}

function Chip({ icon, children, title }: { icon: IconName; children: React.ReactNode; title?: string }) {
  return (
    <span className="chip head-chip" title={title}>
      <Icon name={icon} size={14} />
      {children}
    </span>
  );
}

/** Header and tabs shared by every view of one session. */
export function SessionLayout() {
  const { id = "" } = useParams();
  const live = useSession(id);
  // Sessions hidden from the list (no cwd yet) are still reachable by URL.
  const [fetched, setFetched] = useState<Session | null>(null);
  const [missing, setMissing] = useState(false);
  const now = useNow();
  const eventCount = useEventCount(id);

  useEffect(() => {
    if (live) return;
    api
      .session(id)
      .then((d) => setFetched(d.session))
      .catch(() => setMissing(true));
  }, [id, live]);

  const session = live ?? fetched;
  if (missing && !session) {
    return (
      <section className="card">
        <EmptyState icon="sessions" title="Session not found." />
        <p className="note" style={{ textAlign: "center" }}>
          <Link to="/">Back to sessions</Link>
        </p>
      </section>
    );
  }
  if (!session) return <p className="empty">Loading…</p>;

  const agents = session.subagents.length;
  const counts: Record<string, string | null> = {
    events: eventCount,
    flow: agents > 0 ? `${agents} ${agents === 1 ? "agent" : "agents"}` : null,
  };

  return (
    <>
      <header className="card session-head">
        <nav aria-label="Breadcrumb" className="crumbs">
          <Link to="/">Sessions</Link>
          <Icon name="chevronRight" size={14} />
          <span>{projectName(session.cwd)}</span>
        </nav>
        <div className="session-title">
          <h1>{session.title ?? projectName(session.cwd)}</h1>
          <div className="head-status">
            <StatusBadge status={session.status} />
            {session.activity.phase !== "ended" && <ActivityBadge activity={session.activity} now={now} always />}
          </div>
        </div>
        <div className="head-chips">
          <span className="chip head-chip mono-chip" title={session.cwd}>
            <Icon name="project" size={14} />
            <span className="mono ellipsis-path">{session.cwd}</span>
            <CopyButton text={session.cwd} label="Copy path" compact />
          </span>
          {session.gitBranch && <Chip icon="branch">{session.gitBranch}</Chip>}
          {session.model && <Chip icon="model">{session.model}</Chip>}
          {session.entrypoint && <Chip icon="open">{session.entrypoint}</Chip>}
          {session.pid !== undefined && (
            <Chip icon="processes">
              <span className="mono">pid {session.pid}</span>
            </Chip>
          )}
          <Chip icon="time" title={formatDateTime(session.startedAt)}>
            Started {new Date(session.startedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })}
          </Chip>
        </div>
        <nav className="tabs" aria-label="Session views">
          {SESSION_TABS.map((t) => (
            <NavLink key={t.path} to={`/sessions/${session.id}${t.path ? `/${t.path}` : ""}`} end>
              <Icon name={t.icon} />
              {t.label}
              {counts[t.path] && <span className="tab-count">{counts[t.path]}</span>}
            </NavLink>
          ))}
        </nav>
      </header>
      <Outlet context={{ session } satisfies SessionContext} />
    </>
  );
}
