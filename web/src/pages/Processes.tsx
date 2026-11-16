import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { ProcessInfo } from "@claude-monitor/shared";
import { api, subscribe } from "../api";
import { EmptyState, ErrorState, Tile } from "../components/common";
import { Icon } from "../components/Icon";
import { formatDuration, projectName, useNow } from "../format";

/** CPU samples kept per process, in page memory only. */
const MAX_SAMPLES = 60;

type SortKey = "cpu" | "mem";

const formatMb = (bytes: number): string => {
  const mb = bytes / 1_048_576;
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
};

function CpuSpark({ values }: { values: number[] }) {
  if (values.length < 2) return <span className="spark-empty" aria-hidden="true" />;
  const w = 72;
  const h = 22;
  const max = Math.max(5, ...values);
  const points = values.map((v, i) => `${((i / (values.length - 1)) * w).toFixed(1)},${(h - 2 - (v / max) * (h - 4)).toFixed(1)}`).join(" ");
  return (
    <svg className="cpu-spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <polyline points={points} fill="none" stroke="var(--teal)" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ProcessesPage() {
  const [processes, setProcesses] = useState<ProcessInfo[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "cpu", dir: "desc" });
  const history = useRef(new Map<number, number[]>());
  const [, setTick] = useState(0);
  const now = useNow();

  useEffect(() => {
    const record = (list: ProcessInfo[]): void => {
      const alive = new Set(list.map((p) => p.pid));
      for (const pid of history.current.keys()) if (!alive.has(pid)) history.current.delete(pid);
      for (const p of list) {
        const samples = history.current.get(p.pid) ?? [];
        samples.push(p.cpu);
        if (samples.length > MAX_SAMPLES) samples.shift();
        history.current.set(p.pid, samples);
      }
      setProcesses(list);
      setTick((t) => t + 1);
    };
    const load = (): void => {
      api
        .processes()
        .then((list) => {
          record(list);
          setFailed(false);
        })
        .catch(() => setFailed(true));
    };
    load();
    return subscribe((message) => {
      if (message.type === "process_changed") record(message.processes);
    }, load);
  }, []);

  const sorted = useMemo(() => {
    if (!processes) return [];
    const k = sort.key;
    return [...processes].sort((a, b) => (sort.dir === "desc" ? b[k] - a[k] : a[k] - b[k]));
  }, [processes, sort]);

  const totals = useMemo(() => {
    const list = processes ?? [];
    return {
      count: list.length,
      linked: list.filter((p) => p.sessionId).length,
      cpu: list.reduce((s, p) => s + p.cpu, 0),
      mem: list.reduce((s, p) => s + p.mem, 0),
      maxMem: Math.max(0, ...list.map((p) => p.mem)),
    };
  }, [processes]);

  const chooseSort = (key: SortKey) => setSort((prev) => (prev.key === key ? { key, dir: prev.dir === "desc" ? "asc" : "desc" } : { key, dir: "desc" }));
  const sortHeader = (key: SortKey, label: string) => {
    const on = sort.key === key;
    return (
      <th className="num" aria-sort={on ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
        <button className={on ? "sort on" : "sort"} onClick={() => chooseSort(key)}>
          {label}
          <Icon name={on ? (sort.dir === "asc" ? "sortUp" : "sortDown") : "sort"} size={13} />
        </button>
      </th>
    );
  };

  const unlinked = totals.count - totals.linked;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Processes</h1>
          <div className="muted">Live Claude Code processes on this machine</div>
        </div>
      </div>

      <section className="tiles">
        <Tile icon="processes" label="Processes" value={String(totals.count)} sub={`${totals.linked} linked to a session`} />
        <Tile icon="pulse" label="Total CPU" value={`${totals.cpu.toFixed(1)}%`} sub="sum of all processes" />
        <Tile icon="memory" label="Total memory" value={formatMb(totals.mem)} sub="resident" />
        <Tile icon="warning" label="Unlinked" value={String(unlinked)} sub={unlinked > 0 ? "no matching session" : "every process has a session"} />
      </section>

      <section className="card">
        {failed && <ErrorState title="Can't reach the monitor server." hint="Data on screen may be stale." />}
        {processes?.length === 0 && <EmptyState icon="processes" title="No Claude Code processes are running." />}
        {sorted.length > 0 && (
          <div className="table-wrap">
            <table className="procs">
              <thead>
                <tr>
                  <th className="num">PID</th>
                  <th>Project</th>
                  {sortHeader("cpu", "CPU")}
                  {sortHeader("mem", "Memory")}
                  <th className="num">Uptime</th>
                  <th>Session</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((p) => (
                  <tr key={p.pid}>
                    <td className="num mono">{p.pid}</td>
                    <td className="project">
                      <div className="ellipsis-strong">{p.cwd ? projectName(p.cwd) : "-"}</div>
                      {p.cwd && (
                        <div className="mono muted ellipsis" title={p.cwd}>
                          {p.cwd}
                        </div>
                      )}
                    </td>
                    <td className="num">
                      <div className="cpu-cell">
                        <CpuSpark values={history.current.get(p.pid) ?? []} />
                        <span>{p.cpu.toFixed(1)}%</span>
                      </div>
                    </td>
                    <td>
                      <div className="cell-bar">
                        <span className="num">{formatMb(p.mem)}</span>
                        <span className="hbar" aria-hidden="true">
                          <span style={{ width: `${totals.maxMem ? (p.mem / totals.maxMem) * 100 : 0}%`, background: "var(--iris)" }} />
                        </span>
                      </div>
                    </td>
                    <td className="num">{p.startedAt ? formatDuration(now - Date.parse(p.startedAt)) : "-"}</td>
                    <td>
                      {p.sessionId ? (
                        <Link to={`/sessions/${p.sessionId}`} className="mono">
                          {p.sessionId.slice(0, 8)}
                        </Link>
                      ) : (
                        <span className="chip chip-warning">Unlinked</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {unlinked > 0 && (
          <p className="note">
            Unlinked: a Claude Code process whose folder matches no session the monitor knows, for example one that has not written its first transcript line yet, or one left
            running after its session ended.
          </p>
        )}
        <p className="note">CPU sparklines show the samples received since this page opened (up to {MAX_SAMPLES} per process).</p>
      </section>
    </>
  );
}
