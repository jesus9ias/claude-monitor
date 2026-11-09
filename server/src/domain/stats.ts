import { emptyUsage, totalTokens, type QuotaAttributionRow, type Stats, type StatsRange, type StatsRow } from "@claude-monitor/shared";
import { addUsage, type SessionStore } from "./sessions.js";

const localDay = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Tokens and cost per local day and model, over every API message in range. */
export function computeStats(store: SessionStore, range: StatsRange, now: Date = new Date()): Stats {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  start.setDate(start.getDate() - (range === "today" ? 0 : range === "7d" ? 6 : 29));
  const startMs = start.getTime();

  const rows = new Map<string, StatsRow>();
  for (const state of store.states.values()) {
    for (const m of state.messages.values()) {
      const at = new Date(m.ts);
      if (at.getTime() < startMs) continue;
      const day = localDay(at);
      const key = `${day}|${m.model}`;
      let row = rows.get(key);
      if (!row) {
        row = { day, model: m.model, usage: emptyUsage(), costUsd: 0 };
        rows.set(key, row);
      }
      addUsage(row.usage, m.usage);
      row.costUsd = row.costUsd === null || m.costUsd === null ? null : row.costUsd + m.costUsd;
    }
  }
  return {
    range,
    rows: [...rows.values()].sort((a, b) => a.day.localeCompare(b.day) || a.model.localeCompare(b.model)),
  };
}

/** Each session's share of usage since `sinceMs` (the start of a quota window), heaviest first. */
export function computeAttribution(store: SessionStore, sinceMs: number): QuotaAttributionRow[] {
  const rows: QuotaAttributionRow[] = [];
  for (const state of store.states.values()) {
    const { session } = state;
    if (!session.cwd) continue;
    let tokens = 0;
    let outputTokens = 0;
    let costUsd = 0;
    for (const m of state.messages.values()) {
      if (Date.parse(m.ts) < sinceMs) continue;
      tokens += totalTokens(m.usage);
      outputTokens += m.usage.output;
      costUsd += m.costUsd ?? 0;
    }
    if (tokens > 0) rows.push({ sessionId: session.id, title: session.title, cwd: session.cwd, tokens, outputTokens, costUsd });
  }
  return rows.sort((a, b) => b.costUsd - a.costUsd || b.tokens - a.tokens);
}
