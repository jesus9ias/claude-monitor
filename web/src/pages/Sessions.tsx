import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { totalTokens, type Session, type Stats, type StatsRange } from "@claude-monitor/shared";
import { api, subscribe } from "../api";
import { CurrentTool, StatusBadge, Tile } from "../components/common";
import { CostByDayChart } from "../components/CostByDayChart";
import { formatAgo, formatCost, formatTokens, projectName, useNow } from "../format";

const RANGES: { value: StatsRange; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
];
const STATS_REFRESH_MS = 2000;

export function SessionsPage() {
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<StatsRange>("7d");
  const [stats, setStats] = useState<Stats | null>(null);
  const navigate = useNavigate();
  const now = useNow();

  const rangeRef = useRef(range);
  rangeRef.current = range;
  const statsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadStats = useCallback(() => {
    api.stats(rangeRef.current).then(setStats).catch(() => undefined);
  }, []);
  const loadSessions = useCallback(() => {
    api
      .sessions()
      .then((s) => {
        setSessions(s);
        setError(null);
      })
      .catch(() => setError("Can't reach the monitor server."));
  }, []);

  useEffect(() => {
    loadSessions();
    return subscribe(
      (message) => {
        if (message.type !== "session_updated") return;
        const updated = message.session;
        setSessions((current) => {
          if (!current) return current;
          const others = current.filter((s) => s.id !== updated.id);
          return [updated, ...others].sort((a, b) => b.lastEventAt.localeCompare(a.lastEventAt));
        });
        statsTimer.current ??= setTimeout(() => {
          statsTimer.current = null;
          loadStats();
        }, STATS_REFRESH_MS);
      },
      () => {
        loadSessions();
        loadStats();
      },
    );
  }, [loadSessions, loadStats]);

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

  const rangeLabel = RANGES.find((r) => r.value === range)?.label.toLowerCase();
  const activeCount = sessions?.filter((s) => s.status === "active").length ?? 0;

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
        <h2>Sessions</h2>
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
              {sessions?.map((s) => (
                <tr key={s.id} tabIndex={0} onClick={() => navigate(`/sessions/${s.id}`)} onKeyDown={(e) => e.key === "Enter" && navigate(`/sessions/${s.id}`)}>
                  <td>
                    <StatusBadge status={s.status} />
                    <CurrentTool current={s.current} now={now} />
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
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
