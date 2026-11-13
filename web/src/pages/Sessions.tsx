import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { totalTokens, type Session, type Stats, type StatsRange } from "@claude-monitor/shared";
import { api, subscribe } from "../api";
import { ActivityBadge, StatusBadge, Tile } from "../components/common";
import { CostByDayChart } from "../components/CostByDayChart";
import { formatAgo, formatCost, formatTokens, projectName, useNow } from "../format";
import { useLive } from "../state/live";

const RANGES: { value: StatsRange; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
];
const STATS_REFRESH_MS = 2000;

type TableView = "history" | "project";
const VIEWS: { value: TableView; label: string }[] = [
  { value: "history", label: "History" },
  { value: "project", label: "By project" },
];
const VIEW_KEY = "claude-monitor.sessions.view";
const COLLAPSED_KEY = "claude-monitor.sessions.collapsed";

// Per-browser preferences; the page works the same when storage is unavailable.
function readStored(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? undefined : JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function writeStored(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage blocked or full: the choice is just not remembered.
  }
}

interface ProjectGroup {
  cwd: string;
  sessions: Session[];
  active: number;
  tokens: number;
  cache: number;
  /** null when any session's cost is unknown. */
  costUsd: number | null;
  lastEventAt: string;
}

/** Groups by full cwd. Input is newest first, so rows inside a group keep that order. */
function groupByProject(sessions: Session[]): ProjectGroup[] {
  const groups = new Map<string, ProjectGroup>();
  for (const s of sessions) {
    let g = groups.get(s.cwd);
    if (!g) {
      g = { cwd: s.cwd, sessions: [], active: 0, tokens: 0, cache: 0, costUsd: 0, lastEventAt: s.lastEventAt };
      groups.set(s.cwd, g);
    }
    g.sessions.push(s);
    if (s.status === "active") g.active++;
    g.tokens += s.usage.input + s.usage.output;
    g.cache += s.usage.cacheRead + s.usage.cacheCreate;
    g.costUsd = g.costUsd === null || s.costUsd === null ? null : g.costUsd + s.costUsd;
    if (s.lastEventAt > g.lastEventAt) g.lastEventAt = s.lastEventAt;
  }
  return [...groups.values()].sort((a, b) => b.lastEventAt.localeCompare(a.lastEventAt));
}

export function SessionsPage() {
  const sessions = useLive((s) => s.sessions);
  const error = useLive((s) => s.sessionsError);
  const [range, setRange] = useState<StatsRange>("7d");
  const [stats, setStats] = useState<Stats | null>(null);
  const [view, setView] = useState<TableView>(() => (readStored(VIEW_KEY) === "project" ? "project" : "history"));
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    const stored = readStored(COLLAPSED_KEY);
    return new Set(Array.isArray(stored) ? stored.filter((c): c is string => typeof c === "string") : []);
  });
  const navigate = useNavigate();
  const now = useNow();

  const rangeRef = useRef(range);
  rangeRef.current = range;
  const statsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadStats = useCallback(() => {
    api.stats(rangeRef.current).then(setStats).catch(() => undefined);
  }, []);

  // Sessions come from the live store; stats follow them, debounced.
  useEffect(
    () =>
      subscribe((message) => {
        if (message.type !== "session_updated") return;
        statsTimer.current ??= setTimeout(() => {
          statsTimer.current = null;
          loadStats();
        }, STATS_REFRESH_MS);
      }, loadStats),
    [loadStats],
  );

  useEffect(loadStats, [range, loadStats]);

  const totals = useMemo(() => {
    let cost = 0;
    let tokens = 0;
    for (const row of stats?.rows ?? []) {
      cost += row.costUsd ?? 0;
      tokens += totalTokens(row.usage);
    }
    return { cost, tokens };
  }, [stats]);

  const groups = useMemo(() => (view === "project" && sessions ? groupByProject(sessions) : []), [view, sessions]);

  const chooseView = (next: TableView) => {
    setView(next);
    writeStored(VIEW_KEY, next);
  };

  const toggleGroup = (cwd: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(cwd)) next.add(cwd);
      writeStored(COLLAPSED_KEY, [...next]);
      return next;
    });
  };

  const rangeLabel = RANGES.find((r) => r.value === range)?.label.toLowerCase();
  const activeCount = sessions?.filter((s) => s.status === "active").length ?? 0;

  const renderRow = (s: Session, nested = false) => (
    <tr
      key={s.id}
      className={nested ? "nested" : undefined}
      tabIndex={0}
      onClick={() => navigate(`/sessions/${s.id}`)}
      onKeyDown={(e) => e.key === "Enter" && navigate(`/sessions/${s.id}`)}
    >
      <td>
        <StatusBadge status={s.status} />
        <ActivityBadge activity={s.activity} now={now} />
      </td>
      <td className="project">
        <div>{projectName(s.cwd)}</div>
        <div className="muted ellipsis">{s.title ?? s.id.slice(0, 8)}</div>
      </td>
      <td>{s.model ?? "-"}</td>
      <td className="num">{formatTokens(s.usage.input + s.usage.output)}</td>
      <td className="num">{formatTokens(s.usage.cacheRead + s.usage.cacheCreate)}</td>
      <td className="num">{formatCost(s.costUsd)}</td>
      <td className="num">{formatAgo(s.lastEventAt, now)}</td>
    </tr>
  );

  return (
    <>
      <div className="filter-row">
        <div className="segmented" role="group" aria-label="Date range">
          {RANGES.map((r) => (
            <button key={r.value} className={r.value === range ? "selected" : ""} aria-pressed={r.value === range} onClick={() => setRange(r.value)}>
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <section className="tiles">
        <Tile label="Estimated cost" value={formatCost(totals.cost)} sub={rangeLabel} />
        <Tile label="Tokens" value={formatTokens(totals.tokens)} sub={`${rangeLabel}, including cache`} />
        <Tile label="Active now" value={String(activeCount)} sub={`of ${sessions?.length ?? 0} sessions`} />
      </section>

      <section className="card">
        <h2>Cost by day</h2>
        <CostByDayChart rows={stats?.rows ?? []} />
      </section>

      <section className="card">
        <div className="chart-head wrap">
          <h2>Sessions</h2>
          <div className="segmented" role="group" aria-label="Session table view">
            {VIEWS.map((v) => (
              <button key={v.value} className={v.value === view ? "selected" : ""} aria-pressed={v.value === view} onClick={() => chooseView(v.value)}>
                {v.label}
              </button>
            ))}
          </div>
        </div>
        {error && <p className="error">{error}</p>}
        {sessions?.length === 0 && <p className="empty">No Claude Code sessions found.</p>}
        <div className="table-wrap">
          <table className="rows">
            <thead>
              <tr>
                <th>Status</th>
                <th>Project</th>
                <th>Model</th>
                <th className="num">In + out</th>
                <th className="num">Cache</th>
                <th className="num">Cost</th>
                <th className="num">Last activity</th>
              </tr>
            </thead>
            <tbody>
              {view === "history" && sessions?.map((s) => renderRow(s))}
              {view === "project" &&
                groups.map((g) => {
                  const open = !collapsed.has(g.cwd);
                  const name = projectName(g.cwd);
                  return (
                    <Fragment key={g.cwd}>
                      <tr className="group-row" onClick={() => toggleGroup(g.cwd)}>
                        <td>
                          <button
                            className="group-toggle"
                            aria-expanded={open}
                            aria-label={`${open ? "Collapse" : "Expand"} ${name}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleGroup(g.cwd);
                            }}
                          >
                            <span className={open ? "chevron open" : "chevron"} aria-hidden="true">
                              ▸
                            </span>
                          </button>
                          {g.active > 0 && <span className="group-active">{g.active} active</span>}
                        </td>
                        <td className="project" title={g.cwd}>
                          <div className="group-name">{name}</div>
                          <div className="muted ellipsis">
                            {g.sessions.length} {g.sessions.length === 1 ? "session" : "sessions"}
                          </div>
                        </td>
                        <td />
                        <td className="num">{formatTokens(g.tokens)}</td>
                        <td className="num">{formatTokens(g.cache)}</td>
                        <td className="num">{formatCost(g.costUsd)}</td>
                        <td className="num">{formatAgo(g.lastEventAt, now)}</td>
                      </tr>
                      {open && g.sessions.map((s) => renderRow(s, true))}
                    </Fragment>
                  );
                })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
