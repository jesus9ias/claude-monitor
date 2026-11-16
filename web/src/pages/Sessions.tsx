import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { totalTokens, type Session, type SessionStatus, type Stats, type StatsRange } from "@claude-monitor/shared";
import { api, subscribe } from "../api";
import { ActivityBadge, EmptyState, ErrorState, StatusBadge } from "../components/common";
import { CostByDayChart, seriesColor } from "../components/CostByDayChart";
import { Icon, type IconName } from "../components/Icon";
import { formatAgo, formatCost, formatDateTime, formatPct, formatTokens, projectName, useNow } from "../format";
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

type StatusFilter = "all" | SessionStatus;
const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "idle", label: "Idle" },
  { value: "ended", label: "Ended" },
];

type SortKey = "status" | "project" | "model" | "tokens" | "cost" | "last";
type Sort = { key: SortKey; dir: "asc" | "desc" };
const DEFAULT_SORT: Sort = { key: "last", dir: "desc" };
const STATUS_RANK: Record<SessionStatus, number> = { active: 0, idle: 1, ended: 2 };

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

/** Local midnight at the start of the range; the same start /api/stats uses. */
function rangeStartMs(range: StatsRange, now: number): number {
  const d = new Date(now);
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  start.setDate(start.getDate() - (range === "today" ? 0 : range === "7d" ? 6 : 29));
  return start.getTime();
}

const localDay = (ms: number): string => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** One entry per day of the range, oldest first, so sparklines have no gaps. */
function rangeDays(startMs: number, now: number): string[] {
  const days: string[] = [];
  const d = new Date(startMs);
  while (d.getTime() <= now) {
    days.push(localDay(d.getTime()));
    d.setDate(d.getDate() + 1);
  }
  return days;
}

const sessionTokens = (s: Session): number => s.usage.input + s.usage.output + s.usage.cacheRead + s.usage.cacheCreate;

function compareSessions(a: Session, b: Session, sort: Sort): number {
  let d = 0;
  switch (sort.key) {
    case "status":
      d = STATUS_RANK[a.status] - STATUS_RANK[b.status];
      break;
    case "project":
      d = projectName(a.cwd).localeCompare(projectName(b.cwd));
      break;
    case "model":
      d = (a.model ?? "").localeCompare(b.model ?? "");
      break;
    case "tokens":
      d = sessionTokens(a) - sessionTokens(b);
      break;
    case "cost":
      d = (a.costUsd ?? -1) - (b.costUsd ?? -1);
      break;
    case "last":
      d = a.lastEventAt.localeCompare(b.lastEventAt);
      break;
  }
  if (d === 0) d = a.lastEventAt.localeCompare(b.lastEventAt);
  return sort.dir === "asc" ? d : -d;
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

/** Groups by full cwd; rows inside a group keep the input order. Groups by latest activity. */
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

function Sparkline({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2 || values.every((v) => v === 0)) return null;
  const max = Math.max(...values);
  const w = 96;
  const h = 32;
  const points = values.map((v, i) => `${((i / (values.length - 1)) * w).toFixed(1)},${(h - 3 - (max > 0 ? v / max : 0) * (h - 6)).toFixed(1)}`).join(" ");
  return (
    <svg className="sparkline" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <polyline points={points} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SparkTile({ icon, label, value, sub, spark, color }: { icon: IconName; label: string; value: string; sub?: string; spark?: number[]; color: string }) {
  return (
    <div className="tile">
      <div className="tile-label">
        <span style={{ color }}>
          <Icon name={icon} size={16} />
        </span>
        {label}
      </div>
      <div className="tile-main">
        <div className="tile-value">{value}</div>
        {spark && <Sparkline values={spark} color={color} />}
      </div>
      {sub && <div className="tile-sub">{sub}</div>}
    </div>
  );
}

/** In / out / cache as one stacked bar, scaled to the largest shown session. */
function TokenBar({ s, max }: { s: Session; max: number }) {
  const total = sessionTokens(s);
  const pct = (v: number) => `${max > 0 ? (v / max) * 100 : 0}%`;
  const title = `In ${formatTokens(s.usage.input)} · Out ${formatTokens(s.usage.output)} · Cache ${formatTokens(s.usage.cacheRead + s.usage.cacheCreate)}`;
  return (
    <div className="cell-bar" title={title}>
      <span className="num">{formatTokens(total)}</span>
      <span className="hbar stacked" aria-hidden="true">
        <span className="seg-in" style={{ width: pct(s.usage.input) }} />
        <span className="seg-out" style={{ width: pct(s.usage.output) }} />
        <span className="seg-cache" style={{ width: pct(s.usage.cacheRead + s.usage.cacheCreate) }} />
      </span>
    </div>
  );
}

function CostBar({ cost, max }: { cost: number | null; max: number }) {
  return (
    <div className="cell-bar">
      <span className="num">{formatCost(cost)}</span>
      <span className="hbar" aria-hidden="true">
        <span style={{ width: `${cost !== null && max > 0 ? (cost / max) * 100 : 0}%`, background: "var(--ember)" }} />
      </span>
    </div>
  );
}

function CopyId({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="btn btn-icon row-action"
      aria-label={copied ? "Session id copied" : "Copy session id"}
      title={copied ? "Copied" : "Copy session id"}
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard
          ?.writeText(id)
          .then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          })
          .catch(() => undefined);
      }}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <Icon name={copied ? "ok" : "copy"} size={16} />
    </button>
  );
}

const SORTABLE: { key: SortKey; label: string }[] = [
  { key: "status", label: "Status" },
  { key: "project", label: "Session" },
  { key: "model", label: "Model" },
];

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
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [model, setModel] = useState<string>("all");
  const [sort, setSort] = useState<Sort>(DEFAULT_SORT);
  const searchRef = useRef<HTMLInputElement>(null);
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

  // Ctrl K (Cmd K on a Mac) focuses the search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Changes only when the range does or the local day turns over, not every tick.
  const startMs = rangeStartMs(range, now);
  const today = localDay(now);

  const tiles = useMemo(() => {
    const days = rangeDays(startMs, Date.parse(`${today}T12:00:00`));
    const index = new Map(days.map((d, i) => [d, i]));
    const cost = days.map(() => 0);
    const tokens = days.map(() => 0);
    const hit = days.map(() => ({ read: 0, input: 0 }));
    let read = 0;
    let input = 0;
    for (const row of stats?.rows ?? []) {
      const i = index.get(row.day);
      const allInput = row.usage.input + row.usage.cacheRead + row.usage.cacheCreate;
      read += row.usage.cacheRead;
      input += allInput;
      const h = i === undefined ? undefined : hit[i];
      if (i === undefined || !h) continue;
      cost[i] = (cost[i] ?? 0) + (row.costUsd ?? 0);
      tokens[i] = (tokens[i] ?? 0) + totalTokens(row.usage);
      h.read += row.usage.cacheRead;
      h.input += allInput;
    }
    return {
      cost,
      tokens,
      hitRate: hit.map((h) => (h.input > 0 ? h.read / h.input : 0)),
      totalCost: cost.reduce((a, b) => a + b, 0),
      totalTokens: tokens.reduce((a, b) => a + b, 0),
      overallHit: input > 0 ? read / input : null,
    };
  }, [stats, startMs, today]);

  const inRange = useMemo(
    () => sessions?.filter((s) => s.status === "active" || Date.parse(s.lastEventAt) >= startMs) ?? [],
    [sessions, startMs],
  );

  const models = useMemo(() => [...new Set(inRange.map((s) => s.model).filter((m): m is string => !!m))].sort(), [inRange]);

  // Search and model filter first; the status chips count what those leave.
  const matched = useMemo(() => {
    const q = query.trim().toLowerCase();
    return inRange.filter(
      (s) =>
        (model === "all" || s.model === model) &&
        (!q || projectName(s.cwd).toLowerCase().includes(q) || (s.title ?? "").toLowerCase().includes(q) || s.id.toLowerCase().includes(q)),
    );
  }, [inRange, query, model]);

  const statusCounts = useMemo(() => {
    const c: Record<StatusFilter, number> = { all: matched.length, active: 0, idle: 0, ended: 0 };
    for (const s of matched) c[s.status]++;
    return c;
  }, [matched]);

  const shown = useMemo(
    () => matched.filter((s) => status === "all" || s.status === status).sort((a, b) => compareSessions(a, b, sort)),
    [matched, status, sort],
  );

  const groups = useMemo(() => (view === "project" ? groupByProject(shown) : []), [view, shown]);
  const maxTokens = useMemo(() => Math.max(0, ...shown.map(sessionTokens)), [shown]);
  const maxCost = useMemo(() => Math.max(0, ...shown.map((s) => s.costUsd ?? 0)), [shown]);

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

  const chooseSort = (key: SortKey) =>
    setSort((prev) => (prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "project" || key === "model" || key === "status" ? "asc" : "desc" }));

  const filtersActive = query.trim() !== "" || status !== "all" || model !== "all";
  const clearFilters = () => {
    setQuery("");
    setStatus("all");
    setModel("all");
  };

  const rangeLabel = RANGES.find((r) => r.value === range)?.label.toLowerCase();
  const activeCount = sessions?.filter((s) => s.status === "active").length ?? 0;
  const open = (s: Session) => navigate(`/sessions/${s.id}`);

  const sortHeader = (k: SortKey, label: string, num = false) => {
    const on = sort.key === k;
    return (
      <th key={k} className={num ? "num" : undefined} aria-sort={on ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
        <button className={on ? "sort on" : "sort"} onClick={() => chooseSort(k)}>
          {label}
          <Icon name={on ? (sort.dir === "asc" ? "sortUp" : "sortDown") : "sort"} size={13} />
        </button>
      </th>
    );
  };

  const renderRow = (s: Session, nested = false) => (
    <tr key={s.id} className={nested ? "nested" : undefined} tabIndex={0} onClick={() => open(s)} onKeyDown={(e) => e.key === "Enter" && open(s)}>
      <td>
        <StatusBadge status={s.status} />
      </td>
      <td className="project">
        <div className="ellipsis-strong">{s.title ?? s.id.slice(0, 8)}</div>
        <div className="muted ellipsis" title={s.cwd}>
          {projectName(s.cwd)}
        </div>
      </td>
      <td>
        {s.model ? (
          <span className="model-tag">
            <span className="swatch" style={{ background: seriesColor(s.model) }} />
            {s.model.replace(/^claude-/, "")}
          </span>
        ) : (
          "-"
        )}
      </td>
      <td className="doing">
        <ActivityBadge activity={s.activity} now={now} />
      </td>
      <td>
        <TokenBar s={s} max={maxTokens} />
      </td>
      <td>
        <CostBar cost={s.costUsd} max={maxCost} />
      </td>
      <td className="num" title={formatDateTime(s.lastEventAt)}>
        {formatAgo(s.lastEventAt, now)}
      </td>
      <td className="actions">
        <CopyId id={s.id} />
      </td>
    </tr>
  );

  const renderCard = (s: Session) => (
    <li key={s.id}>
      <a
        href={`/sessions/${s.id}`}
        className="session-card control"
        onClick={(e) => {
          e.preventDefault();
          open(s);
        }}
      >
        <div className="sc-top">
          <StatusBadge status={s.status} />
          <span className="muted small" title={formatDateTime(s.lastEventAt)}>
            {formatAgo(s.lastEventAt, now)}
          </span>
        </div>
        <div className="ellipsis-strong">{s.title ?? s.id.slice(0, 8)}</div>
        <div className="muted small sc-meta">
          <Icon name="project" size={14} />
          {projectName(s.cwd)}
          {s.model && (
            <>
              <span className="swatch" style={{ background: seriesColor(s.model) }} />
              {s.model.replace(/^claude-/, "")}
            </>
          )}
        </div>
        <ActivityBadge activity={s.activity} now={now} />
        <CostBar cost={s.costUsd} max={maxCost} />
      </a>
    </li>
  );

  const groupRow = (g: ProjectGroup, isOpen: boolean, name: string) => (
    <tr className="group-row" onClick={() => toggleGroup(g.cwd)}>
      <td>
        <button
          className="group-toggle"
          aria-expanded={isOpen}
          aria-label={`${isOpen ? "Collapse" : "Expand"} ${name}`}
          onClick={(e) => {
            e.stopPropagation();
            toggleGroup(g.cwd);
          }}
        >
          <span className={isOpen ? "chevron open" : "chevron"}>
            <Icon name="chevronRight" size={14} />
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
      <td />
      <td className="num" title={`In + out ${formatTokens(g.tokens)} · Cache ${formatTokens(g.cache)}`}>
        {formatTokens(g.tokens + g.cache)}
      </td>
      <td className="num">{formatCost(g.costUsd)}</td>
      <td className="num" title={formatDateTime(g.lastEventAt)}>
        {formatAgo(g.lastEventAt, now)}
      </td>
      <td />
    </tr>
  );

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Sessions</h1>
          <div className="muted">
            {inRange.length} in {rangeLabel} · {activeCount} working now
          </div>
        </div>
        <div className="segmented" role="group" aria-label="Date range">
          {RANGES.map((r) => (
            <button key={r.value} aria-pressed={r.value === range} onClick={() => setRange(r.value)}>
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <section className="tiles">
        <SparkTile icon="cost" label="Estimated cost" value={formatCost(tiles.totalCost)} sub={rangeLabel} spark={tiles.cost} color="var(--ember)" />
        <SparkTile icon="tokens" label="Tokens" value={formatTokens(tiles.totalTokens)} sub={`${rangeLabel}, including cache`} spark={tiles.tokens} color="var(--iris)" />
        <SparkTile icon="pulse" label="Active now" value={String(activeCount)} sub={`of ${sessions?.length ?? 0} sessions`} color="var(--teal)" />
        <SparkTile
          icon="cache"
          label="Cache hit rate"
          value={tiles.overallHit === null ? "n/a" : formatPct(tiles.overallHit)}
          sub="cache read / all input"
          spark={tiles.hitRate}
          color="var(--teal)"
        />
      </section>

      <section className="card">
        <h2>Usage by day</h2>
        <CostByDayChart rows={stats?.rows ?? []} />
      </section>

      <section className="card sessions-card">
        <div className="chart-head wrap">
          <h2>Sessions</h2>
          <div className="segmented" role="group" aria-label="Session table view">
            {VIEWS.map((v) => (
              <button key={v.value} aria-pressed={v.value === view} onClick={() => chooseView(v.value)}>
                {v.label}
              </button>
            ))}
          </div>
        </div>

        <div className="table-tools">
          <label className="search well">
            <Icon name="search" />
            <span className="sr-only">Search sessions</span>
            <input ref={searchRef} type="search" placeholder="Search project, title or id" value={query} onChange={(e) => setQuery(e.target.value)} />
            <kbd>Ctrl K</kbd>
          </label>
          <div className="chips" role="group" aria-label="Filter by status">
            {STATUS_FILTERS.map((f) => (
              <button key={f.value} className="fchip" aria-pressed={status === f.value} onClick={() => setStatus(f.value)}>
                {f.value !== "all" && <span className={`dot dot-${f.value}`} aria-hidden="true" />}
                {f.label}
                <span className="muted">{statusCounts[f.value]}</span>
              </button>
            ))}
          </div>
          <label className="select well">
            <Icon name="model" size={16} />
            <span className="sr-only">Filter by model</span>
            <select value={model} onChange={(e) => setModel(e.target.value)}>
              <option value="all">All models</option>
              {models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
        </div>

        {error && <ErrorState title={error} hint="Retrying when the stream reconnects. Data on screen may be stale." />}
        {sessions?.length === 0 && <EmptyState icon="sessions" title="No Claude Code sessions found." />}
        {sessions && sessions.length > 0 && inRange.length === 0 && <EmptyState title="No sessions in this range." hint="Try a longer range." />}
        {inRange.length > 0 && shown.length === 0 && (
          <div className="state">
            <span className="state-icon">
              <Icon name="filter" size={22} />
            </span>
            <strong>No sessions match these filters.</strong>
            <button className="btn" onClick={clearFilters}>
              Clear filters
            </button>
          </div>
        )}

        {shown.length > 0 && (
          <>
            <div className="table-wrap sticky-head desktop-only">
              <table className="rows">
                <thead>
                  <tr>
                    {SORTABLE.map((c) => sortHeader(c.key, c.label))}
                    <th>Doing now</th>
                    {sortHeader("tokens", "Tokens")}
                    {sortHeader("cost", "Cost")}
                    {sortHeader("last", "Last activity", true)}
                    <th>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {view === "history" && shown.map((s) => renderRow(s))}
                  {view === "project" &&
                    groups.map((g) => {
                      const isOpen = !collapsed.has(g.cwd);
                      return (
                        <Fragment key={g.cwd}>
                          {groupRow(g, isOpen, projectName(g.cwd))}
                          {isOpen && g.sessions.map((s) => renderRow(s, true))}
                        </Fragment>
                      );
                    })}
                </tbody>
              </table>
            </div>

            <div className="phone-only">
              {view === "history" && <ul className="session-cards">{shown.map(renderCard)}</ul>}
              {view === "project" &&
                groups.map((g) => {
                  const isOpen = !collapsed.has(g.cwd);
                  const name = projectName(g.cwd);
                  return (
                    <div key={g.cwd} className="card-group">
                      <button className="card-group-head" aria-expanded={isOpen} onClick={() => toggleGroup(g.cwd)}>
                        <span className={isOpen ? "chevron open" : "chevron"}>
                          <Icon name="chevronRight" size={14} />
                        </span>
                        <span className="group-name">{name}</span>
                        <span className="muted small">
                          {g.sessions.length} · {formatCost(g.costUsd)}
                        </span>
                        {g.active > 0 && <span className="group-active">{g.active} active</span>}
                      </button>
                      {isOpen && <ul className="session-cards">{g.sessions.map(renderCard)}</ul>}
                    </div>
                  );
                })}
            </div>
          </>
        )}

        {inRange.length > 0 && (
          <div className="table-foot muted small">
            Showing {shown.length} of {inRange.length}
            {filtersActive && (
              <button className="link-btn" onClick={clearFilters}>
                Clear filters
              </button>
            )}
          </div>
        )}
      </section>
    </>
  );
}
