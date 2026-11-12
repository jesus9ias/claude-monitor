import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { StatsRow } from "@claude-monitor/shared";
import { formatCost } from "../format";

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

const seriesColor = (model: string): string => {
  const slot = MODEL_SLOTS.indexOf(model);
  return slot === -1 ? "var(--series-other)" : `var(--series-${slot + 1})`;
};
const seriesKey = (model: string): string => (MODEL_SLOTS.includes(model) ? model : OTHER);
const dayLabel = (day: string): string => day.slice(5).replace("-", "/");

type DayRow = { day: string; __top?: string } & Record<string, number | string | undefined>;

function RoundedTopBar(props: any) {
  const { x, y, width, height, fill, dataKey, payload } = props;
  if (!height || height <= 0) return null;
  const r = payload.__top === dataKey ? Math.min(4, width / 2, height) : 0;
  return (
    <path
      d={`M${x},${y + height} V${y + r} Q${x},${y} ${x + r},${y} H${x + width - r} Q${x + width},${y} ${x + width},${y + r} V${y + height} Z`}
      fill={fill}
      stroke="var(--surface)"
      strokeWidth={2}
    />
  );
}

function ChartTooltip({ active, payload, label }: any) {
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
          <strong>{formatCost(p.value)}</strong>
        </div>
      ))}
      <div className="chart-tooltip-row total">
        <span>Total</span>
        <strong>{formatCost(total)}</strong>
      </div>
    </div>
  );
}

type Share = { model: string; cost: number };

const percent = (part: number, total: number): string => {
  const p = total > 0 ? (part / total) * 100 : 0;
  return p > 0 && p < 1 ? "<1%" : `${Math.round(p)}%`;
};

/** Cost share per model over the whole range, heaviest first. */
function ModelShareDonut({ shares }: { shares: Share[] }) {
  const total = shares.reduce((sum, s) => sum + s.cost, 0);
  return (
    <figure className="share-donut">
      <figcaption>By model</figcaption>
      <div className="share-donut-ring">
        <ResponsiveContainer width="100%" height={180}>
          <PieChart>
            <Pie
              data={shares}
              dataKey="cost"
              nameKey="model"
              innerRadius="62%"
              outerRadius="100%"
              startAngle={90}
              endAngle={-270}
              stroke="var(--surface)"
              strokeWidth={2}
              isAnimationActive={false}
            >
              {shares.map((s) => (
                <Cell key={s.model} fill={seriesColor(s.model)} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="share-donut-center">
          <strong>{formatCost(total)}</strong>
          <span>total</span>
        </div>
      </div>
      <ul className="share-list">
        {shares.map((s) => (
          <li key={s.model}>
            <span className="swatch" style={{ background: seriesColor(s.model) }} />
            <span className="share-name">{s.model}</span>
            <span className="share-pct">{percent(s.cost, total)}</span>
            <strong>{formatCost(s.cost)}</strong>
          </li>
        ))}
      </ul>
    </figure>
  );
}

export function CostByDayChart({ rows }: { rows: StatsRow[] }) {
  const [showTable, setShowTable] = useState(false);

  const { data, keys, shares, unpriced } = useMemo(() => {
    const byDay = new Map<string, DayRow>();
    const present = new Set<string>();
    let unpricedRows = 0;
    for (const row of rows) {
      if (row.costUsd === null) {
        unpricedRows++;
        continue;
      }
      const key = seriesKey(row.model);
      present.add(key);
      const entry = byDay.get(row.day) ?? { day: row.day };
      entry[key] = Number(entry[key] ?? 0) + row.costUsd;
      byDay.set(row.day, entry);
    }
    const ordered = [...MODEL_SLOTS, OTHER].filter((k) => present.has(k));
    for (const entry of byDay.values()) {
      entry.__top = [...ordered].reverse().find((k) => Number(entry[k] ?? 0) > 0);
    }
    const shares = ordered
      .map((model) => ({ model, cost: [...byDay.values()].reduce((sum, d) => sum + Number(d[model] ?? 0), 0) }))
      .filter((s) => s.cost > 0)
      .sort((a, b) => b.cost - a.cost);
    return { data: [...byDay.values()], keys: ordered, shares, unpriced: unpricedRows };
  }, [rows]);

  if (data.length === 0) return <p className="empty">No priced usage in this range.</p>;

  return (
    <>
      <div className="chart-head">
        <div className="legend">
          {keys.map((k) => (
            <span className="legend-item" key={k}>
              <span className="swatch" style={{ background: seriesColor(k) }} />
              {k}
            </span>
          ))}
        </div>
        <button className="ghost" onClick={() => setShowTable((v) => !v)}>
          {showTable ? "Chart" : "Table"}
        </button>
      </div>
      {showTable ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Day</th>
                {keys.map((k) => (
                  <th className="num" key={k}>
                    {k}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.day}>
                  <td>{d.day}</td>
                  {keys.map((k) => (
                    <td className="num" key={k}>
                      {d[k] === undefined ? "-" : formatCost(Number(d[k]))}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="cost-charts">
          <div className="cost-bars">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} maxBarSize={36}>
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
                  tickFormatter={(v: number) => `$${v}`}
                  tick={{ fill: "var(--text-muted)", fontSize: 12 }}
                  axisLine={false}
                  tickLine={false}
                  width={48}
                />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: "var(--hover)" }} isAnimationActive={false} />
                {keys.map((k) => (
                  <Bar key={k} dataKey={k} stackId="cost" fill={seriesColor(k)} shape={<RoundedTopBar />} isAnimationActive={false} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
          <ModelShareDonut shares={shares} />
        </div>
      )}
      {unpriced > 0 && <p className="note">Excludes models with no price in pricing.json.</p>}
    </>
  );
}
