import { useMemo } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { UsagePoint } from "@claude-monitor/shared";
import { formatInt, formatTime, formatTokens } from "../format";

interface Point {
  ts: number;
  value: number;
}

function LineTooltip({ active, payload, unit }: any) {
  if (!active || !payload?.length) return null;
  const point: Point = payload[0].payload;
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-title">{formatTime(new Date(point.ts).toISOString())}</div>
      <div className="chart-tooltip-row">
        <span>{unit}</span>
        <strong>{formatInt(point.value)}</strong>
      </div>
    </div>
  );
}

function SmallLine({ title, unit, data }: { title: string; unit: string; data: Point[] }) {
  return (
    <figure className="small-chart">
      <figcaption>{title}</figcaption>
      <ResponsiveContainer width="100%" height={180}>
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
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
          <YAxis
            tickFormatter={formatTokens}
            tick={{ fill: "var(--text-muted)", fontSize: 12 }}
            axisLine={false}
            tickLine={false}
            width={48}
          />
          <Tooltip content={<LineTooltip unit={unit} />} cursor={{ stroke: "var(--baseline)" }} isAnimationActive={false} />
          <Line
            dataKey="value"
            stroke="var(--series-1)"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, stroke: "var(--surface)", strokeWidth: 2 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </figure>
  );
}

/**
 * Two charts rather than one with two scales: context size runs orders of magnitude above
 * output, so on a shared axis output would look flat.
 */
export function TokenCharts({ series }: { series: UsagePoint[] }) {
  const { context, output } = useMemo(() => {
    let cumulative = 0;
    const contextPoints: Point[] = [];
    const outputPoints: Point[] = [];
    for (const { ts, usage } of series) {
      const at = Date.parse(ts);
      cumulative += usage.output;
      contextPoints.push({ ts: at, value: usage.input + usage.cacheRead + usage.cacheCreate });
      outputPoints.push({ ts: at, value: cumulative });
    }
    return { context: contextPoints, output: outputPoints };
  }, [series]);

  if (series.length === 0) return <p className="empty">No API messages yet.</p>;
  return (
    <div className="chart-grid">
      <SmallLine title="Output tokens, cumulative" unit="Output tokens" data={output} />
      <SmallLine title="Context size per message" unit="Prompt tokens" data={context} />
    </div>
  );
}
