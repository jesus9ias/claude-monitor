/**
 * The ONLY place that knows the Claude Code statusline payload. A statusline command installed by
 * `npm run hooks:install -- --statusline` posts it here after each assistant message; only
 * `rate_limits` is read.
 *
 *   rate_limits.five_hour.used_percentage  (0-100)   rate_limits.five_hour.resets_at  (Unix seconds)
 *   rate_limits.seven_day.used_percentage             rate_limits.seven_day.resets_at
 *
 * Present only for subscribers, and only after the session's first API answer.
 */
import type { QuotaWindow } from "@claude-monitor/shared";
import type { QuotaReading } from "../infra/anthropic.js";

export function parseStatusline(body: unknown): QuotaReading | null {
  if (!body || typeof body !== "object") return null;
  const limits = (body as Record<string, unknown>).rate_limits;
  if (!limits || typeof limits !== "object") return null;
  const l = limits as Record<string, unknown>;
  const win = (v: unknown): QuotaWindow | undefined => {
    if (!v || typeof v !== "object") return undefined;
    const w = v as Record<string, unknown>;
    if (typeof w.used_percentage !== "number" || !Number.isFinite(w.used_percentage)) return undefined;
    return {
      usedPct: w.used_percentage,
      resetsAt: typeof w.resets_at === "number" ? new Date(w.resets_at * 1000).toISOString() : undefined,
    };
  };
  const reading = { fiveHour: win(l.five_hour), sevenDay: win(l.seven_day) };
  return reading.fiveHour || reading.sevenDay ? reading : null;
}
