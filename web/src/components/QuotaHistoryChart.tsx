import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { QuotaSample } from "@claude-monitor/shared";

type Key = "fiveHour" | "sevenDay";

interface Point {
  t: number;
  fiveHour?: number | null;
  sevenDay?: number | null;
  fiveHourProj?: number;
  sevenDayProj?: number;
}

/** A dashed line from now to a later time at the current pace (used %). */
export interface Projection {
  key: Key;
  from: { t: number; used: number };
  to: { t: number; used: number };
}

const SERIES = [
  { key: "fiveHour", label: "5-hour", color: "var(--ember)" },
  { key: "sevenDay", label: "Weekly", color: "var(--iris)" },
] as const;

const fmtDay = (t: number): string => new Date(t).toLocaleString("en-US", { weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false });
const pct = (v: number | null | undefined): string => (v === null || v === undefined ? "-" : `${Math.round(v)}%`);

function HistoryTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const p: Point = payload[0].payload;
  const projected = p.fiveHour === undefined && p.sevenDay === undefined;
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-title">
        {fmtDay(p.t)}
        {projected && " · projected"}
      </div>
      {SERIES.map((s) => (
        <div className="chart-tooltip-row" key={s.key}>
          <span className="swatch" style={{ background: s.color }} />
          <span>{s.label} used</span>
          <strong>{pct(projected ? p[`${s.key}Proj`] : p[s.key])}</strong>
        </div>
      ))}
    </div>
  );
}

/**
 * Used % of each window over time, with the "getting low" and "almost out" bands, reset markers
 * (a 5-hour drop of more than 10 points), a "now" marker and the projection at the current pace.
 */
export function QuotaHistoryChart({ samples, projections = [], now }: { samples: QuotaSample[]; projections?: Projection[]; now?: number }) {
  const [asTable, setAsTable] = useState(false);
  const readings = useMemo<Point[]>(() => samples.map((s) => ({ t: Date.parse(s.ts), fiveHour: s.fiveHour, sevenDay: s.sevenDay })), [samples]);
  const resets = useMemo(
    () =>
      readings
        .filter((p, i) => i > 0 && p.fiveHour != null && readings[i - 1]!.fiveHour != null && p.fiveHour < readings[i - 1]!.fiveHour! - 10)
        .map((p) => p.t),
    [readings],
  );
  const points = useMemo<Point[]>(() => {
    const extra: Point[] = [];
    for (const pr of projections) {
      extra.push({ t: pr.from.t, [`${pr.key}Proj`]: pr.from.used }, { t: pr.to.t, [`${pr.key}Proj`]: Math.min(100, pr.to.used) });
    }
    return [...readings, ...extra].sort((a, b) => a.t - b.t);
  }, [readings, projections]);

  if (readings.length < 2) return <p className="empty">History builds up as readings arrive. Each refresh adds a point.</p>;

  return (
    <>
      <div className="chart-head wrap">
        <div className="legend">
          {SERIES.map((s) => (
            <span key={s.key} className="legend-item">
              <span className="swatch" style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
          <span className="legend-item">
            <span className="swatch band-low" />
            Getting low
          </span>
          <span className="legend-item">
            <span className="swatch band-out" />
            Almost out
          </span>
          <span className="legend-item muted">dashed: resets and projection</span>
        </div>
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
              {[...readings].reverse().map((p) => (
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
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={points} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <ReferenceArea y1={70} y2={90} fill="var(--amber)" fillOpacity={0.08} ifOverflow="hidden" />
            <ReferenceArea y1={90} y2={100} fill="var(--rose)" fillOpacity={0.12} ifOverflow="hidden" />
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
            {now !== undefined && (
              <ReferenceLine x={now} stroke="var(--text-secondary)" label={{ value: "now", position: "insideTopLeft", fill: "var(--text-secondary)", fontSize: 11 }} />
            )}
            <Tooltip content={<HistoryTooltip />} cursor={{ stroke: "var(--baseline)" }} isAnimationActive={false} />
            {SERIES.map((s) => (
              <Line
                key={s.key}
                name={s.label}
                dataKey={s.key}
                stroke={s.color}
                strokeWidth={2}
                dot={false}
                connectNulls
                activeDot={{ r: 4, stroke: "var(--ink)", strokeWidth: 2 }}
                isAnimationActive={false}
              />
            ))}
            {SERIES.map((s) => (
              <Line
                key={`${s.key}Proj`}
                dataKey={`${s.key}Proj`}
                stroke={s.color}
                strokeWidth={2}
                strokeDasharray="6 5"
                dot={false}
                connectNulls
                activeDot={false}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      )}
    </>
  );
}
