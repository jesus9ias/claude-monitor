/** Claude subscription usage limits, as a percentage of each window. */

export type QuotaSource = "usage" | "probe" | "statusline";

export interface QuotaWindow {
  /** 0-100. */
  usedPct: number;
  resetsAt?: string;
}

export interface Quota {
  /**
   * not_configured: no token and no statusline feed yet.
   * ok: `fetchedAt` holds the last good reading.
   * error: the last attempt failed; the windows, if any, are from an earlier reading.
   */
  status: "not_configured" | "ok" | "error";
  source?: QuotaSource;
  fetchedAt?: string;
  fiveHour?: QuotaWindow;
  sevenDay?: QuotaWindow;
  /** Per-model weekly windows, when the plan has them ("Opus", "Sonnet", ...). */
  sevenDayByModel?: Record<string, QuotaWindow>;
  /** Short, safe message. Never contains the token. */
  error?: string;
}

export const remainingPct = (w: QuotaWindow | undefined): number | undefined =>
  w === undefined ? undefined : Math.max(0, Math.min(100, 100 - w.usedPct));

export interface QuotaSample {
  ts: string;
  /** Used percentages. null when that reading had no such window. */
  fiveHour: number | null;
  sevenDay: number | null;
}

export interface Pace {
  /** Percentage points used per hour, over the lookback. */
  ratePctPerHour: number;
  /** When the window would hit 100% at this rate. Absent when usage is flat. */
  exhaustAt?: string;
  /** True when exhaustAt comes before the window resets. */
  beforeReset?: boolean;
}

/** Below this rate the window is treated as flat: no exhaustion projected. */
const FLAT_RATE = 0.05;
const MIN_SPAN_MS = 5 * 60_000;

/**
 * Projects when a window runs out, by least squares over the recent readings of that window. Only
 * readings after the last reset count (a drop of more than 1 point). An estimate, and labelled as one.
 */
export function projectPace(
  samples: { ts: string; usedPct: number }[],
  window: QuotaWindow | undefined,
  now: number,
  lookbackMs: number,
): Pace | undefined {
  if (!window) return undefined;
  let points = samples
    .map((s) => ({ t: Date.parse(s.ts), v: s.usedPct }))
    .filter((p) => Number.isFinite(p.t) && p.t >= now - lookbackMs && p.t <= now)
    .sort((a, b) => a.t - b.t);
  for (let i = points.length - 1; i > 0; i--) {
    if (points[i]!.v < points[i - 1]!.v - 1) {
      points = points.slice(i);
      break;
    }
  }
  if (points.length < 2 || points[points.length - 1]!.t - points[0]!.t < MIN_SPAN_MS) return undefined;

  const n = points.length;
  const hours = points.map((p) => (p.t - points[0]!.t) / 3_600_000);
  const meanX = hours.reduce((a, b) => a + b, 0) / n;
  const meanY = points.reduce((a, p) => a + p.v, 0) / n;
  let num = 0;
  let den = 0;
  points.forEach((p, i) => {
    num += (hours[i]! - meanX) * (p.v - meanY);
    den += (hours[i]! - meanX) ** 2;
  });
  const rate = den === 0 ? 0 : num / den;
  if (rate < FLAT_RATE) return { ratePctPerHour: Math.max(0, rate) };

  const left = Math.max(0, 100 - window.usedPct);
  const exhaust = now + (left / rate) * 3_600_000;
  const reset = window.resetsAt ? Date.parse(window.resetsAt) : NaN;
  return {
    ratePctPerHour: rate,
    exhaustAt: new Date(exhaust).toISOString(),
    beforeReset: Number.isFinite(reset) ? exhaust < reset : undefined,
  };
}

export interface QuotaAttributionRow {
  sessionId: string;
  title?: string;
  cwd: string;
  tokens: number;
  outputTokens: number;
  /** API-price estimate. Used as the weight of each session's share, since it weighs token types. */
  costUsd: number;
}

/** The alerts that a reading should raise now, given what was already sent. Pure; the UI sends them as browser notifications. */
export function dueAlerts(quota: Quota, thresholds: number[], sent: ReadonlySet<string>): { key: string; title: string; body: string }[] {
  const out: { key: string; title: string; body: string }[] = [];
  const windows: [string, string, QuotaWindow | undefined][] = [
    ["5h", "5-hour limit", quota.fiveHour],
    ["7d", "Weekly limit", quota.sevenDay],
  ];
  for (const [id, name, w] of windows) {
    const left = remainingPct(w);
    if (left === undefined) continue;
    // Only the lowest crossed threshold: no burst of three notifications at once.
    const crossed = thresholds.filter((t) => left <= t).sort((a, b) => a - b)[0];
    if (crossed === undefined) continue;
    const key = `${id}:${w?.resetsAt ?? "?"}:${crossed}`;
    if (sent.has(key)) continue;
    const reset = w?.resetsAt ? ` Resets ${new Date(w.resetsAt).toLocaleString("en-US", { weekday: "short", hour: "2-digit", minute: "2-digit" })}.` : "";
    out.push({ key, title: `Claude ${name}: ${Math.round(left)}% left`, body: `Below your ${crossed}% alert.${reset}` });
  }
  return out;
}

