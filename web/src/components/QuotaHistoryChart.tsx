import { useMemo, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { QuotaSample } from "@claude-monitor/shared";

interface Point {
  t: number;
  fiveHour: number | null;
  sevenDay: number | null;
}

const SERIES = [
  { key: "fiveHour", label: "5-hour", color: "var(--series-1)" },
  { key: "sevenDay", label: "Weekly", color: "var(--series-2)" },
] as const;

const fmtDay = (t: number): string => new Date(t).toLocaleString("en-US", { weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false });
const pct = (v: number | null): string => (v === null ? "-" : `${Math.round(v)}%`);

function HistoryTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const p: Point = payload[0].payload;
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-title">{fmtDay(p.t)}</div>
      {SERIES.map((s) => (
        <div className="chart-tooltip-row" key={s.key}>
          <span>
            <span className="swatch" style={{ background: s.color }} /> {s.label} used
          </span>
          <strong>{pct(p[s.key])}</strong>
        </div>
      ))}
    </div>
  );
}

/** Used % of each window over time. A drop of more than 10 points marks a 5-hour reset. */
export function QuotaHistoryChart({ samples }: { samples: QuotaSample[] }) {
  const [asTable, setAsTable] = useState(false);
  const points = useMemo<Point[]>(() => samples.map((s) => ({ t: Date.parse(s.ts), fiveHour: s.fiveHour, sevenDay: s.sevenDay })), [samples]);
  const resets = useMemo(
    () => points.filter((p, i) => i > 0 && p.fiveHour !== null && points[i - 1]!.fiveHour !== null && p.fiveHour < points[i - 1]!.fiveHour! - 10).map((p) => p.t),
    [points],
  );

  if (points.length < 2) return <p className="empty">History builds up as readings arrive. Each refresh adds a point.</p>;

  return (
    <>
      <div className="chart-head">
        <span className="muted small">{points.length} readings · dashed lines mark 5-hour resets</span>
        <button className="ghost" onClick={() => setAsTable((v) => !v)} aria-pressed={asTable}>
          {asTable ? "Chart" : "Table"}
        </button>
      </div>
      {asTable ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th className="num">5-hour used</th>
                <th className="num">Weekly used</th>
              </tr>
            </thead>
            <tbody>
              {[...points].reverse().map((p) => (
                <tr key={p.t}>
                  <td>{fmtDay(p.t)}</td>
                  <td className="num">{pct(p.fiveHour)}</td>
                  <td className="num">{pct(p.sevenDay)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={points} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--grid)" />
            <XAxis
              dataKey="t"
              type="number"
              domain={["dataMin", "dataMax"]}
              tickFormatter={fmtDay}
              stroke="var(--baseline)"
              tick={{ fill: "var(--text-muted)", fontSize: 12 }}
              tickLine={false}
              minTickGap={64}
            />
            <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={(v: number) => `${v}%`} tick={{ fill: "var(--text-muted)", fontSize: 12 }} axisLine={false} tickLine={false} width={44} />
            {resets.map((t) => (
              <ReferenceLine key={t} x={t} stroke="var(--baseline)" strokeDasharray="3 3" />
            ))}
            <Tooltip content={<HistoryTooltip />} cursor={{ stroke: "var(--baseline)" }} isAnimationActive={false} />
            <Legend iconType="plainline" wrapperStyle={{ fontSize: 12, color: "var(--text-secondary)" }} />
            {SERIES.map((s) => (
              <Line
                key={s.key}
                name={s.label}
                dataKey={s.key}
                stroke={s.color}
                strokeWidth={2}
                dot={false}
                connectNulls
                activeDot={{ r: 4, stroke: "var(--surface)", strokeWidth: 2 }}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      )}
    </>
  );
}
