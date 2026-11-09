/**
 * All configuration, from the environment. `.env` at the repo root is loaded first when present;
 * variables already set in the real environment win. Secrets are only ever held here and in the
 * quota client: never logged, never sent to the UI.
 */
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type QuotaSourceSetting = "auto" | "usage" | "probe" | "off";

export interface Config {
  host: string;
  port: number;
  claudeDir: string;
  projectsDir: string;
  sessionsDir: string;
  dataDir: string;
  quota: {
    token?: string;
    source: QuotaSourceSetting;
    intervalMs: number;
    probeModel: string;
    /** Remaining-percent thresholds for browser notifications, highest first. */
    alerts: number[];
  };
}

/** "20,5" -> [20, 5]. "off" or empty -> []. Values outside 1-99 are dropped. */
export function parseAlerts(value: string | undefined): number[] {
  if (value === undefined) return [20, 5];
  if (!value.trim() || value.trim().toLowerCase() === "off") return [];
  const nums = value
    .split(",")
    .map((v) => Number(v.trim()))
    .filter((n) => Number.isFinite(n) && n >= 1 && n <= 99);
  return [...new Set(nums)].sort((a, b) => b - a);
}

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

export function loadEnvFile(file = process.env.CLAUDE_MONITOR_ENV_FILE ?? path.join(REPO_ROOT, ".env")): void {
  try {
    process.loadEnvFile(file);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error(`Could not load ${file}: ${err instanceof Error ? err.message.split("\n")[0] : "unknown error"}`);
    }
  }
}

const SOURCES: readonly QuotaSourceSetting[] = ["auto", "usage", "probe", "off"];
const MIN_QUOTA_INTERVAL_S = 60;

export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const claudeDir = env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
  const source = (env.CLAUDE_MONITOR_QUOTA_SOURCE ?? "auto").trim().toLowerCase() as QuotaSourceSetting;
  const intervalS = Number(env.CLAUDE_MONITOR_QUOTA_INTERVAL) || 300;
  return {
    host: "127.0.0.1",
    port: Number(env.CLAUDE_MONITOR_PORT) || 4317,
    claudeDir,
    projectsDir: env.CLAUDE_MONITOR_PROJECTS_DIR || path.join(claudeDir, "projects"),
    sessionsDir: env.CLAUDE_MONITOR_SESSIONS_DIR || path.join(claudeDir, "sessions"),
    dataDir: env.CLAUDE_MONITOR_DATA_DIR || path.join(REPO_ROOT, "data"),
    quota: {
      token: env.CLAUDE_CODE_OAUTH_TOKEN?.trim() || undefined,
      source: SOURCES.includes(source) ? source : "auto",
      intervalMs: Math.max(MIN_QUOTA_INTERVAL_S, intervalS) * 1000,
      probeModel: env.CLAUDE_MONITOR_QUOTA_PROBE_MODEL?.trim() || "claude-haiku-5-5",
      alerts: parseAlerts(env.CLAUDE_MONITOR_QUOTA_ALERTS),
    },
  };
}
