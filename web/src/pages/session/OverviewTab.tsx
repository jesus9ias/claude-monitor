import { useEffect, useRef, useState } from "react";
import type { UsagePoint } from "@claude-monitor/shared";
import { api, subscribe } from "../../api";
import { Tile } from "../../components/common";
import { GitPanel } from "../../components/GitPanel";
import { Icon } from "../../components/Icon";
import { TokenCharts } from "../../components/TokenCharts";
import { formatCost, formatPct, formatTokens } from "../../format";
import { useSessionContext } from "./SessionLayout";

const SERIES_REFRESH_MS = 2000;

/** Cache read as a share of all input: whether the cache is doing its work. */
function CacheRing({ read, write, fresh }: { read: number; write: number; fresh: number }) {
  const all = read + write + fresh;
  const rate = all > 0 ? read / all : 0;
  const r = 52;
  const c = 2 * Math.PI * r;
  return (
    <div className="cache-ring">
      <svg width={132} height={132} viewBox="0 0 132 132" role="img" aria-label={`Cache hit rate ${formatPct(rate)}`}>
        <circle cx={66} cy={66} r={r} fill="none" stroke="rgba(0,0,0,.35)" strokeWidth={12} />
        <circle
          cx={66}
          cy={66}
          r={r}
          fill="none"
          stroke="var(--teal)"
          strokeWidth={12}
          strokeLinecap="round"
          strokeDasharray={`${rate * c} ${c}`}
          transform="rotate(-90 66 66)"
        />
        <text x={66} y={66} textAnchor="middle" className="ring-value">
          {all > 0 ? formatPct(rate) : "n/a"}
        </text>
        <text x={66} y={86} textAnchor="middle" className="ring-label">
          hit rate
        </text>
      </svg>
      <dl className="ring-facts">
        <div>
          <dt>
            <span className="swatch" style={{ background: "var(--teal)" }} />
            Cache read
          </dt>
          <dd>{formatTokens(read)}</dd>
        </div>
        <div>
          <dt>
            <span className="swatch" style={{ background: "var(--amber)" }} />
            Cache write
          </dt>
          <dd>{formatTokens(write)}</dd>
        </div>
        <div>
          <dt>
            <span className="swatch" style={{ background: "var(--iris)" }} />
            Fresh input
          </dt>
          <dd>{formatTokens(fresh)}</dd>
        </div>
      </dl>
    </div>
  );
}

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

  const u = session.usage;
  const allTokens = u.input + u.output + u.cacheRead + u.cacheCreate;
  const allInput = u.input + u.cacheRead + u.cacheCreate;
  const hours = Math.max(0, Date.parse(session.lastEventAt) - Date.parse(session.startedAt)) / 3_600_000;
  const perHour = session.costUsd !== null && hours >= 0.05 ? `${formatCost(session.costUsd / hours)} per hour` : undefined;
  const running = session.activity.agents.length;

  const models = Object.entries(session.usageByModel)
    .map(([model, mu]) => ({ model, usage: mu, total: mu.input + mu.output + mu.cacheRead + mu.cacheCreate }))
    .sort((a, b) => b.total - a.total);
  const modelTotal = models.reduce((sum, m) => sum + m.total, 0);

  return (
    <>
      <section className="tiles">
        <Tile icon="cost" label="Estimated cost" value={formatCost(session.costUsd)} sub={perHour} />
        <Tile icon="tokens" label="Input" value={formatTokens(u.input)} sub="fresh, not cached" />
        <Tile icon="output" label="Output" value={formatTokens(u.output)} sub={allTokens > 0 ? `${formatPct(u.output / allTokens)} of all tokens` : undefined} />
        <Tile icon="cache" label="Cache read" value={formatTokens(u.cacheRead)} sub={allInput > 0 ? `${formatPct(u.cacheRead / allInput)} hit rate` : undefined} />
        <Tile icon="cache" label="Cache write" value={formatTokens(u.cacheCreate)} sub={allInput > 0 ? `${formatPct(u.cacheCreate / allInput)} of input` : undefined} />
        <Tile icon="agent" label="Subagents" value={String(session.subagents.length)} sub={running > 0 ? `${running} running now` : undefined} />
      </section>

      <div className="overview-grid">
        <section className="card">
          <h2>Tokens per message</h2>
          <TokenCharts series={series} />
        </section>
        <section className="card">
          <h2>Cache efficiency</h2>
          <CacheRing read={u.cacheRead} write={u.cacheCreate} fresh={u.input} />
        </section>
      </div>

      <section className="card">
        <h2>Git</h2>
        <GitPanel sessionId={session.id} />
      </section>

      <section className="card">
        <h2>Usage by model</h2>
        {models.length === 0 && <p className="empty">No API messages yet.</p>}
        <ul className="model-usage">
          {models.map((m) => (
            <li key={m.model}>
              <div className="mu-line">
                <span className="mu-name">
                  <Icon name="model" size={14} />
                  {m.model}
                  {m.model === session.model && <span className="chip mu-tag">main</span>}
                </span>
                <span className="muted small mu-split">
                  in {formatTokens(m.usage.input)} · out {formatTokens(m.usage.output)} · cache {formatTokens(m.usage.cacheRead + m.usage.cacheCreate)}
                </span>
                <strong className="mu-pct">{modelTotal > 0 ? formatPct(m.total / modelTotal) : "-"}</strong>
              </div>
              <div className="hbar" aria-hidden="true">
                <span style={{ width: `${modelTotal > 0 ? (m.total / modelTotal) * 100 : 0}%`, background: "var(--iris)" }} />
              </div>
            </li>
          ))}
        </ul>
        {models.length > 0 && <p className="note">Share of the session's tokens; the UI has no per-model price.</p>}
      </section>
    </>
  );
}
