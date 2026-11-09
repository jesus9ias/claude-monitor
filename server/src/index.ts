/** Composition root: builds every piece and wires them. No logic of its own. */
import { Bus } from "./bus.js";
import { loadEnvFile, readConfig } from "./config.js";
import { Monitor } from "./domain/monitor.js";
import { loadPricing } from "./domain/pricing.js";
import { QuotaService } from "./domain/quota.js";
import { buildApp } from "./http/app.js";
import { bridge, SseHub } from "./http/sse.js";
import { StateDb } from "./infra/db.js";
import { ProcessMonitor } from "./infra/procs.js";
import { Scanner } from "./ingest/scanner.js";
import { startWatcher } from "./ingest/watcher.js";

const TICK_MS = 5_000;
const PROCESS_POLL_MS = 3_000;
const ACTIVITY_FLUSH_MS = 2_000;

loadEnvFile();
const config = readConfig();

const bus = new Bus();
const db = StateDb.open(config.dataDir);
const monitor = new Monitor(loadPricing(), bus);
const scanner = new Scanner(monitor);
const sse = new SseHub();
bridge(bus, sse);

// Hook-driven activity survives restarts; transcript lines older than it will not override it.
for (const [sessionId, snapshot] of db.loadActivity()) monitor.activity.restore(sessionId, snapshot);

const began = Date.now();
monitor.quiet = true;
const files = await scanner.scanAll(config.projectsDir);

const processes = new ProcessMonitor({
  sessionsDir: config.sessionsDir,
  sessionForCwd: (cwd) => monitor.sessions.sessionForCwd(cwd),
});
// Before the first request, so a live session never shows as ended just after a restart.
const firstPoll = await processes.poll();
if (firstPoll) monitor.applyProcesses(firstPoll);
monitor.tick();
monitor.quiet = false;
console.log(`Loaded ${monitor.sessions.listSessions().length} sessions from ${files} files in ${Date.now() - began} ms.`);

// Persist activity in batches: hooks can fire many times a second.
const dirtyActivity = new Set<string>();
bus.on("activity_changed", (e) => dirtyActivity.add(e.sessionId));
const flushActivity = (): void => {
  if (!dirtyActivity.size) return;
  const rows = [...dirtyActivity].flatMap((sessionId) => {
    const snapshot = monitor.activity.snapshot(sessionId);
    return snapshot ? [{ sessionId, snapshot }] : [];
  });
  dirtyActivity.clear();
  try {
    db.saveActivity(rows);
  } catch (err) {
    console.error(`Could not save activity: ${err instanceof Error ? err.message : "unknown error"}`);
  }
};
setInterval(flushActivity, ACTIVITY_FLUSH_MS).unref();

const quota = new QuotaService({
  ...config.quota,
  bus,
  store: db,
  isActive: () => monitor.isAnyActive(),
});
quota.start();
console.log(
  quota.configured
    ? `Quota: reading from Anthropic (${config.quota.source}).`
    : "Quota: no CLAUDE_CODE_OAUTH_TOKEN in .env; only the statusline feed can update it.",
);

const app = buildApp({
  monitor,
  sse,
  processes: () => processes.list(),
  quota: {
    current: () => quota.current(),
    configured: quota.configured,
    alerts: config.quota.alerts,
    refresh: () => quota.refresh(),
    history: (since) => db.quotaHistory(since),
    fromStatusline: (reading) => quota.fromStatusline(reading),
  },
});
await app.listen({ host: config.host, port: config.port });
console.log(`Claude Monitor on http://${config.host}:${config.port}`);

const stopWatcher = startWatcher(config.projectsDir, scanner);
// Anything written between the boot scan and the watcher starting.
await scanner.scanAll(config.projectsDir);

setInterval(() => monitor.tick(), TICK_MS).unref();
setInterval(async () => {
  const changed = await processes.poll();
  if (changed) monitor.applyProcesses(changed);
}, PROCESS_POLL_MS).unref();

let stopping = false;
const shutdown = async (): Promise<void> => {
  if (stopping) return;
  stopping = true;
  quota.stop();
  sse.closeAll();
  await stopWatcher();
  await app.close();
  flushActivity();
  db.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
