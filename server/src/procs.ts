import { execFile } from "node:child_process";
import { readdir, readFile, readlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { ProcessInfo } from "@claude-monitor/shared";

const exec = promisify(execFile);
const COMMAND_TIMEOUT_MS = 2500;

interface RegistryEntry {
  pid: number;
  sessionId?: string;
  cwd?: string;
  startedAt?: string;
}

interface RawStats {
  pid: number;
  /** Percent of the whole machine. Undefined until there are two samples to compare. */
  cpu?: number;
  /** Cumulative CPU seconds, where the OS gives that instead of a percentage. */
  cpuSeconds?: number;
  mem: number;
  cwd?: string;
}

/**
 * Claude Code registers each live session in <config>/sessions/<pid>.json with its pid, session id
 * and cwd. That is the reliable source on every OS. Files can outlive their process, so an entry
 * only counts once the OS confirms the pid is a running claude process.
 */
async function readRegistry(dir: string): Promise<Map<number, RegistryEntry>> {
  const entries = new Map<number, RegistryEntry>();
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return entries;
  }
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    try {
      const raw = JSON.parse(await readFile(path.join(dir, name), "utf8"));
      if (!Number.isInteger(raw.pid) || raw.pid <= 0) continue;
      entries.set(raw.pid, {
        pid: raw.pid,
        sessionId: typeof raw.sessionId === "string" ? raw.sessionId : undefined,
        cwd: typeof raw.cwd === "string" ? raw.cwd : undefined,
        startedAt: typeof raw.startedAt === "number" ? new Date(raw.startedAt).toISOString() : undefined,
      });
    } catch {
      // Being rewritten right now: the next poll will read it.
    }
  }
  return entries;
}

/** Only registered pids are queried: the desktop app's own claude.exe processes never register. */
async function statsWindows(pids: number[]): Promise<RawStats[]> {
  if (pids.length === 0) return [];
  const script =
    `Get-Process -Id ${pids.join(",")} -ErrorAction SilentlyContinue | ` +
    `Where-Object { $_.ProcessName -like '*claude*' } | ` +
    `Select-Object Id,CPU,WorkingSet64 | ConvertTo-Json -Compress`;
  const { stdout } = await exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    timeout: COMMAND_TIMEOUT_MS,
    windowsHide: true,
  });
  if (!stdout.trim()) return [];
  const parsed = JSON.parse(stdout);
  return (Array.isArray(parsed) ? parsed : [parsed]).map((p: any) => ({
    pid: p.Id,
    cpuSeconds: typeof p.CPU === "number" ? p.CPU : 0,
    mem: p.WorkingSet64 ?? 0,
  }));
}

async function cwdPosix(pid: number): Promise<string | undefined> {
  try {
    if (process.platform === "linux") return await readlink(`/proc/${pid}/cwd`);
    const { stdout } = await exec("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"], { timeout: COMMAND_TIMEOUT_MS });
    return stdout.split("\n").find((l) => l.startsWith("n"))?.slice(1);
  } catch {
    return undefined;
  }
}

async function statsPosix(registered: Set<number>): Promise<RawStats[]> {
  const { stdout } = await exec("ps", ["-axo", "pid=,pcpu=,rss=,command="], { timeout: COMMAND_TIMEOUT_MS });
  const out: RawStats[] = [];
  for (const line of stdout.split("\n")) {
    const match = /^\s*(\d+)\s+([\d.]+)\s+(\d+)\s+(.*)$/.exec(line);
    if (!match) continue;
    const pid = Number(match[1]);
    const command = match[4]!;
    const isCli = /(^|[\s/])claude(\s|$)/.test(command) && !command.includes(".app/");
    if (!registered.has(pid) && !isCli) continue;
    if (!/claude/i.test(command)) continue;
    const stats: RawStats = { pid, cpu: Number(match[2]), mem: Number(match[3]) * 1024 };
    if (!registered.has(pid)) stats.cwd = await cwdPosix(pid);
    out.push(stats);
  }
  return out;
}

export interface ProcsDeps {
  sessionsDir: string;
  /** For a process with no registered session: the most recently active session in that cwd. */
  sessionForCwd: (cwd: string) => string | undefined;
}

export class ProcessMonitor {
  private current: ProcessInfo[] = [];
  private cpuSamples = new Map<number, { seconds: number; at: number }>();
  private polling = false;

  constructor(private readonly deps: ProcsDeps) {}

  list(): ProcessInfo[] {
    return this.current;
  }

  /** Returns the new list when it changed, or null when it did not (or the poll failed). */
  async poll(): Promise<ProcessInfo[] | null> {
    if (this.polling) return null;
    this.polling = true;
    try {
      const registry = await readRegistry(this.deps.sessionsDir);
      const raw =
        process.platform === "win32" ? await statsWindows([...registry.keys()]) : await statsPosix(new Set(registry.keys()));
      const next = raw.map((p) => this.toInfo(p, registry.get(p.pid))).sort((a, b) => a.pid - b.pid);
      const changed = fingerprint(next) !== fingerprint(this.current);
      this.current = next;
      return changed ? next : null;
    } catch {
      return null; // Keep the last known list: a slow machine must not make processes flicker away.
    } finally {
      this.polling = false;
    }
  }

  private toInfo(p: RawStats, entry?: RegistryEntry): ProcessInfo {
    const cwd = entry?.cwd ?? p.cwd;
    return {
      pid: p.pid,
      cwd,
      startedAt: entry?.startedAt,
      cpu: p.cpu ?? this.cpuPercent(p),
      mem: p.mem,
      sessionId: entry?.sessionId ?? (cwd ? this.deps.sessionForCwd(cwd) : undefined),
    };
  }

  private cpuPercent(p: RawStats): number {
    const at = Date.now();
    const seconds = p.cpuSeconds ?? 0;
    const previous = this.cpuSamples.get(p.pid);
    this.cpuSamples.set(p.pid, { seconds, at });
    if (!previous || at <= previous.at) return 0;
    return Math.max(0, ((seconds - previous.seconds) / ((at - previous.at) / 1000) / os.cpus().length) * 100);
  }
}

const fingerprint = (list: ProcessInfo[]): string =>
  JSON.stringify(list.map((p) => [p.pid, p.sessionId, p.cwd, Math.round(p.cpu), Math.round(p.mem / 1_048_576)]));
