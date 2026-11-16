import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { totalTokens, type StatsRow } from "@claude-monitor/shared";
import { formatCost, formatTokens } from "../format";

/** Color follows the model, never its rank. Anything else folds into "Other". */
const MODEL_SLOTS = [
  "claude-opus-5-5",
  "claude-sonnet-5-5",
  "claude-haiku-5-5",
  "claude-opus-5",
  "claude-sonnet-5",
  "claude-opus-4-8",
  "claude-sonnet-4-6",
  "claude-fable-5-2",
  "claude-fable-5-1",
  "claude-fable-5",
];
const OTHER = "Other";

export const seriesColor = (model: string): string => {
  const slot = MODEL_SLOTS.indexOf(model);
  return slot === -1 ? "var(--series-other)" : `var(--series-${slot + 1})`;
};
const seriesKey = (model: string): string => (MODEL_SLOTS.includes(model) ? model : OTHER);
const dayLabel = (day: string): string => day.slice(5).replace("-", "/");

type Metric = "cost" | "tokens";
type DayRow = { day: string; __top?: string; __total: number } & Record<string, number | string | undefined>;

const formatValue = (metric: Metric, v: number): string => (metric === "cost" ? formatCost(v) : formatTokens(v));
const formatAxis = (metric: Metric, v: number): string => (metric === "cost" ? `$${v}` : formatTokens(v));

/** Stacked segment; the top one gets rounded corners and the day total above it. */
function StackSegment(props: any) {
  const { x, y, width, height, fill, dataKey, payload, metric } = props;
  if (!height || height <= 0) return null;
  const top = payload.__top === dataKey;
  const r = top ? Math.min(5, width / 2, height) : 0;
  return (
    <g>
      <path
        d={`M${x},${y + height} V${y + r} Q${x},${y} ${x + r},${y} H${x + width - r} Q${x + width},${y} ${x + width},${y + r} V${y + height} Z`}
        fill={fill}
        stroke="var(--ink)"
        strokeWidth={1.5}
      />
      {top && (
        <text x={x + width / 2} y={y - 6} textAnchor="middle" className="bar-total">
          {formatValue(metric, payload.__total)}
        </text>
      )}
    </g>
  );
}

function ChartTooltip({ active, payload, label, metric }: any) {
  if (!active || !payload?.length) return null;
  const items = [...payload].filter((p: any) => p.value > 0).reverse();
  const total = items.reduce((sum: number, p: any) => sum + p.value, 0);
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-title">{label}</div>
      {items.map((p: any) => (
        <div className="chart-tooltip-row" key={p.dataKey}>
          <span className="swatch" style={{ background: p.fill }} />
          <span>{p.dataKey}</span>
          <strong>{formatValue(metric, p.value)}</strong>
        </div>
      ))}
      <div className="chart-tooltip-row total">
        <span>Total</span>
        <strong>{formatValue(metric, total)}</strong>
      </div>
    </div>
  );
}

const percent = (part: number, total: number): string => {
  const p = total > 0 ? (part / total) * 100 : 0;
  return p > 0 && p < 1 ? "<1%" : `${Math.round(p)}%`;
};

type Share = { model: string; value: number };

/** Share per model over the whole range as bars, heaviest first. */
function ModelBars({ shares, metric }: { shares: Share[]; metric: Metric }) {
  const total = shares.reduce((sum, s) => sum + s.value, 0);
  const max = shares[0]?.value ?? 0;
  return (
    <figure className="model-bars">
      <figcaption>
        <span className="lbl">By model</span>
        <strong>{formatValue(metric, total)}</strong>
      </figcaption>
      <ul>
        {shares.map((s) => (
          <li key={s.model}>
            <div className="model-bar-line">
              <span className="swatch" style={{ background: seriesColor(s.model) }} />
              <span className="share-name">{s.model}</span>
              <span className="share-pct">{percent(s.value, total)}</span>
              <strong>{formatValue(metric, s.value)}</strong>
            </div>
            <div className="hbar">
              <span style={{ width: `${max > 0 ? (s.value / max) * 100 : 0}%`, background: seriesColor(s.model) }} />
            </div>
          </li>
        ))}
      </ul>
    </figure>
  );
}

export function CostByDayChart({ rows }: { rows: StatsRow[] }) {
  const [showTable, setShowTable] = useState(false);
  const [metric, setMetric] = useState<Metric>("cost");
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  const { data, keys, shares, unpriced, average } = useMemo(() => {
    const byDay = new Map<string, DayRow>();
    const present = new Set<string>();
    let unpricedRows = 0;
    for (const row of rows) {
      const value = metric === "cost" ? row.costUsd : totalTokens(row.usage);
      if (value === null) {
        unpricedRows++;
        continue;
      }
      const key = seriesKey(row.model);
      present.add(key);
      const entry = byDay.get(row.day) ?? ({ day: row.day, __total: 0 } as DayRow);
      entry[key] = Number(entry[key] ?? 0) + value;
      byDay.set(row.day, entry);
    }
    const ordered = [...MODEL_SLOTS, OTHER].filter((k) => present.has(k));
    const shown = ordered.filter((k) => !hidden.has(k));
    for (const entry of byDay.values()) {
      entry.__top = [...shown].reverse().find((k) => Number(entry[k] ?? 0) > 0);
      entry.__total = shown.reduce((sum, k) => sum + Number(entry[k] ?? 0), 0);
    }
    const days = [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
    const shares = ordered
      .map((model) => ({ model, value: days.reduce((sum, d) => sum + Number(d[model] ?? 0), 0) }))
      .filter((s) => s.value > 0)
      .sort((a, b) => b.value - a.value);
    const avg = days.length > 0 ? days.reduce((sum, d) => sum + d.__total, 0) / days.length : 0;
    return { data: days, keys: ordered, shares, unpriced: metric === "cost" ? unpricedRows : 0, average: avg };
  }, [rows, metric, hidden]);

  const toggleModel = (k: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (!next.delete(k)) next.add(k);
      return next;
    });

  const shownKeys = keys.filter((k) => !hidden.has(k));

  return (
    <>
      <div className="chart-head wrap">
        <div className="segmented" role="group" aria-label="Chart metric">
          {(["cost", "tokens"] as const).map((m) => (
            <button key={m} aria-pressed={metric === m} onClick={() => setMetric(m)}>
              {m === "cost" ? "Cost" : "Tokens"}
            </button>
          ))}
        </div>
        <button className="ghost" onClick={() => setShowTable((v) => !v)}>
          {showTable ? "Chart" : "Table"}
        </button>
      </div>
      {data.length === 0 ? (
        <p className="empty">{metric === "cost" ? "No priced usage in this range." : "No usage in this range."}</p>
      ) : (
        <>
          <div className="legend legend-toggles" role="group" aria-label="Models shown">
            {keys.map((k) => (
              <button key={k} className="legend-item" aria-pressed={!hidden.has(k)} onClick={() => toggleModel(k)}>
                <span className="swatch" style={{ background: seriesColor(k) }} />
                {k}
              </button>
            ))}
          </div>
          {showTable ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Day</th>
                    {shownKeys.map((k) => (
                      <th className="num" key={k}>
                        {k}
                      </th>
                    ))}
                    <th className="num">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((d) => (
                    <tr key={d.day}>
                      <td>{d.day}</td>
                      {shownKeys.map((k) => (
                        <td className="num" key={k}>
                          {d[k] === undefined ? "-" : formatValue(metric, Number(d[k]))}
                        </td>
                      ))}
                      <td className="num">{formatValue(metric, d.__total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="cost-charts">
              <div className="cost-bars">
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={data} margin={{ top: 24, right: 8, bottom: 0, left: 0 }} maxBarSize={40}>
                    <CartesianGrid vertical={false} stroke="var(--grid)" />
                    <XAxis
                      dataKey="day"
                      tickFormatter={dayLabel}
                      stroke="var(--baseline)"
                      tick={{ fill: "var(--text-muted)", fontSize: 12 }}
                      tickLine={false}
                      minTickGap={16}
                    />
                    <YAxis
                      tickFormatter={(v: number) => formatAxis(metric, v)}
                      tick={{ fill: "var(--text-muted)", fontSize: 12 }}
                      axisLine={false}
                      tickLine={false}
                      width={52}
                    />
                    <Tooltip content={<ChartTooltip metric={metric} />} cursor={{ fill: "var(--hover)" }} isAnimationActive={false} />
                    {average > 0 && (
                      <ReferenceLine
                        y={average}
                        stroke="var(--text-muted)"
                        strokeDasharray="5 5"
                        label={{ value: `avg ${formatValue(metric, average)}`, position: "insideTopRight", fill: "var(--text-muted)", fontSize: 11 }}
                      />
                    )}
                    {shownKeys.map((k) => (
                      <Bar key={k} dataKey={k} stackId="v" fill={seriesColor(k)} shape={<StackSegment metric={metric} />} isAnimationActive={false} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <ModelBars shares={shares} metric={metric} />
            </div>
          )}
        </>
      )}
      {unpriced > 0 && <p className="note">Cost excludes models with no price in pricing.json.</p>}
    </>
  );
}
