import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useOutletContext, useParams } from "react-router-dom";
import type { Session } from "@claude-monitor/shared";
import { api } from "../../api";
import { ActivityBadge, StatusBadge } from "../../components/common";
import { projectName, useNow } from "../../format";
import { useSession } from "../../state/live";

export const SESSION_TABS = [
  { path: "", label: "Overview" },
  { path: "events", label: "Events" },
  { path: "flow", label: "Flow" },
  { path: "pipeline", label: "Pipeline" },
] as const;

export interface SessionContext {
  session: Session;
}

export const useSessionContext = (): SessionContext => useOutletContext<SessionContext>();

/** Header and tabs shared by every view of one session. */
export function SessionLayout() {
  const { id = "" } = useParams();
  const live = useSession(id);
  // Sessions hidden from the list (no cwd yet) are still reachable by URL.
  const [fetched, setFetched] = useState<Session | null>(null);
  const [missing, setMissing] = useState(false);
  const now = useNow();

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
      <p className="empty">
        Session not found. <Link to="/">Back to sessions</Link>
      </p>
    );
  }
  if (!session) return <p className="empty">Loading…</p>;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{session.title ?? projectName(session.cwd)}</h1>
          <div className="muted">
            {session.cwd}
            {session.gitBranch && ` · ${session.gitBranch}`}
            {session.model && ` · ${session.model}`}
            {session.entrypoint && ` · ${session.entrypoint}`}
            {session.pid !== undefined && ` · pid ${session.pid}`}
          </div>
        </div>
        <div className="head-status">
          <StatusBadge status={session.status} />
          <ActivityBadge activity={session.activity} now={now} always />
        </div>
      </div>
      <nav className="tabs" aria-label="Session views">
        {SESSION_TABS.map((t) => (
          <NavLink key={t.path} to={`/sessions/${session.id}${t.path ? `/${t.path}` : ""}`} end>
            {t.label}
          </NavLink>
        ))}
      </nav>
      <Outlet context={{ session } satisfies SessionContext} />
    </>
  );
}
