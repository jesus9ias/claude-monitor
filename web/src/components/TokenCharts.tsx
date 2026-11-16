import { useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { UsagePoint } from "@claude-monitor/shared";
import { formatInt, formatTime, formatTokens } from "../format";

type SeriesKey = "input" | "output" | "cacheRead";

const SERIES: { key: SeriesKey; label: string; color: string }[] = [
  { key: "cacheRead", label: "Cache read", color: "var(--teal)" },
  { key: "input", label: "Input", color: "var(--iris)" },
  { key: "output", label: "Output", color: "var(--ember)" },
];

interface Point {
  ts: number;
  input: number;
  output: number;
  cacheRead: number;
}

function AreaTooltip({ active, payload, shown }: any) {
  if (!active || !payload?.length) return null;
  const point: Point = payload[0].payload;
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-title">{formatTime(new Date(point.ts).toISOString())}</div>
      {SERIES.filter((s) => shown.has(s.key)).map((s) => (
        <div className="chart-tooltip-row" key={s.key}>
          <span className="swatch" style={{ background: s.color }} />
          <span>{s.label}</span>
          <strong>{formatInt(point[s.key])}</strong>
        </div>
      ))}
    </div>
  );
}

/**
 * Input, output and cache read per API message on one chart. Cache read runs far above the
 * others, so each series can be toggled off to bring the smaller ones into scale.
 */
export function TokenCharts({ series }: { series: UsagePoint[] }) {
  const [shown, setShown] = useState<Set<SeriesKey>>(new Set(["input", "output", "cacheRead"]));
  const data = useMemo<Point[]>(
    () => series.map(({ ts, usage }) => ({ ts: Date.parse(ts), input: usage.input, output: usage.output, cacheRead: usage.cacheRead })),
    [series],
  );

  const toggle = (key: SeriesKey) =>
    setShown((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next.size === 0 ? prev : next;
    });

  if (series.length === 0) return <p className="empty">No API messages yet.</p>;
  return (
    <>
      <div className="legend legend-toggles" role="group" aria-label="Series shown">
        {SERIES.map((s) => (
          <button key={s.key} className="legend-item" aria-pressed={shown.has(s.key)} onClick={() => toggle(s.key)}>
            <span className="swatch" style={{ background: s.color }} />
            {s.label}
          </button>
        ))}
      </div>
      <ResponsiveContainer width="100%" height={260}>
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            {SERIES.map((s) => (
              <linearGradient key={s.key} id={`fill-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={s.color} stopOpacity={0.35} />
                <stop offset="100%" stopColor={s.color} stopOpacity={0.02} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid vertical={false} stroke="var(--grid)" />
          <XAxis
            dataKey="ts"
            type="number"
            domain={["dataMin", "dataMax"]}
            tickFormatter={(v: number) => formatTime(new Date(v).toISOString()).slice(0, 5)}
            stroke="var(--baseline)"
            tick={{ fill: "var(--text-muted)", fontSize: 12 }}
            tickLine={false}
            minTickGap={48}
          />
          <YAxis tickFormatter={formatTokens} tick={{ fill: "var(--text-muted)", fontSize: 12 }} axisLine={false} tickLine={false} width={48} />
          <Tooltip content={<AreaTooltip shown={shown} />} cursor={{ stroke: "var(--text-muted)", strokeDasharray: "4 4" }} isAnimationActive={false} />
          {SERIES.filter((s) => shown.has(s.key)).map((s) => (
            <Area
              key={s.key}
              dataKey={s.key}
              type="linear"
              stroke={s.color}
              strokeWidth={2}
              fill={`url(#fill-${s.key})`}
              dot={false}
              activeDot={{ r: 4, stroke: "var(--ink)", strokeWidth: 2 }}
              isAnimationActive={false}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </>
  );
}
