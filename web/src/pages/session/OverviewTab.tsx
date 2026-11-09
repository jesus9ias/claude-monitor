import { useEffect, useRef, useState } from "react";
import type { UsagePoint } from "@claude-monitor/shared";
import { api, subscribe } from "../../api";
import { Tile } from "../../components/common";
import { GitPanel } from "../../components/GitPanel";
import { TokenCharts } from "../../components/TokenCharts";
import { formatCost, formatInt, formatTokens } from "../../format";
import { useSessionContext } from "./SessionLayout";

const SERIES_REFRESH_MS = 2000;

export function OverviewTab() {
  const { session } = useSessionContext();
  const [series, setSeries] = useState<UsagePoint[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const id = session.id;

  useEffect(() => {
    const load = (): void => {
      api.session(id).then((d) => setSeries(d.usageSeries)).catch(() => undefined);
    };
    load();
    const unsubscribe = subscribe((message) => {
      // Usage on existing messages can change, so refresh the series rather than patching it.
      if (message.type !== "session_updated" || message.session.id !== id) return;
      timer.current ??= setTimeout(() => {
        timer.current = null;
        load();
      }, SERIES_REFRESH_MS);
    }, load);
    return () => {
      unsubscribe();
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    };
  }, [id]);

  return (
    <>
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
    </>
  );
}
