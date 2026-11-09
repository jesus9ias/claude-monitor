import { useEffect, useState } from "react";

export const formatCost = (v: number | null | undefined): string => {
  if (v === null || v === undefined) return "n/a";
  return v > 0 && v < 0.01 ? "<$0.01" : `$${v.toFixed(2)}`;
};

export const formatTokens = (v: number): string =>
  new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(v);

export const formatInt = (v: number): string => new Intl.NumberFormat("en-US").format(v);

export function formatAgo(iso: string, now: number): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

export const formatTime = (iso: string): string =>
  new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

export const projectName = (cwd: string): string => cwd.split(/[\\/]/).filter(Boolean).pop() ?? cwd;

/** Re-renders on an interval, so relative times and elapsed counters keep moving. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
