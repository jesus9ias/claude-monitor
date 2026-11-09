import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { ProcessInfo } from "@claude-monitor/shared";
import { api, subscribe } from "../api";
import { formatDuration, projectName, useNow } from "../format";

export function ProcessesPage() {
  const [processes, setProcesses] = useState<ProcessInfo[] | null>(null);
  const [failed, setFailed] = useState(false);
  const now = useNow();

  useEffect(() => {
    const load = (): void => {
      api
        .processes()
        .then((list) => {
          setProcesses(list);
          setFailed(false);
        })
        .catch(() => setFailed(true));
    };
    load();
    return subscribe((message) => {
      if (message.type === "process_changed") setProcesses(message.processes);
    }, load);
  }, []);

  return (
    <section className="card">
      <h2>Live Claude Code processes</h2>
      {failed && <p className="error">Can't reach the monitor server.</p>}
      {processes?.length === 0 && <p className="empty">No Claude Code processes are running.</p>}
      {processes && processes.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th className="num">PID</th>
                <th>Project</th>
                <th className="num">CPU</th>
                <th className="num">Memory</th>
                <th className="num">Uptime</th>
                <th>Session</th>
              </tr>
            </thead>
            <tbody>
              {processes.map((p) => (
                <tr key={p.pid}>
                  <td className="num">{p.pid}</td>
                  <td>{p.cwd ? projectName(p.cwd) : "-"}</td>
                  <td className="num">{p.cpu.toFixed(1)}%</td>
                  <td className="num">{Math.round(p.mem / 1_048_576)} MB</td>
                  <td className="num">{p.startedAt ? formatDuration(now - Date.parse(p.startedAt)) : "-"}</td>
                  <td>{p.sessionId ? <Link to={`/sessions/${p.sessionId}`}>{p.sessionId.slice(0, 8)}</Link> : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
