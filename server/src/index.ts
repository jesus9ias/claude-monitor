import { buildApp } from "./app.js";
import { HOST, PORT, PROJECTS_DIR, SESSIONS_DIR } from "./config.js";
import { loadPricing } from "./pricing.js";
import { ProcessMonitor } from "./procs.js";
import { Scanner, type IngestListener } from "./scanner.js";
import { SseHub } from "./sse.js";
import { Store, type HookUpdate } from "./store.js";
import { startWatcher } from "./watcher.js";

const STATUS_TICK_MS = 5_000;
const PROCESS_POLL_MS = 3_000;

const store = new Store(loadPricing());
const scanner = new Scanner(store);
const sse = new SseHub();

const began = Date.now();
const files = await scanner.scanAll(PROJECTS_DIR);
store.refreshStatuses();
console.log(`Loaded ${store.listSessions().length} sessions from ${files} files in ${Date.now() - began} ms.`);

const onIngest: IngestListener = (state, added) => {
  for (const event of added) sse.broadcast({ type: "event_added", event });
  store.refreshStatuses();
  if (state.session.cwd) sse.broadcast({ type: "session_updated", session: state.session });
};

const onHook = (hook: HookUpdate): void => {
  const { state, added } = store.applyHook(hook);
  for (const event of added) sse.broadcast({ type: "event_added", event });
  store.refreshStatuses();
  if (state.session.cwd) sse.broadcast({ type: "session_updated", session: state.session });
};

const monitor = new ProcessMonitor({
  sessionsDir: SESSIONS_DIR,
  sessionForCwd: (cwd) => store.sessionForCwd(cwd),
});

async function pollProcesses(): Promise<void> {
  const changed = await monitor.poll();
  if (!changed) return;
  sse.broadcast({ type: "process_changed", processes: changed });
  for (const session of store.applyProcesses(changed)) sse.broadcast({ type: "session_updated", session });
  for (const session of store.refreshStatuses()) sse.broadcast({ type: "session_updated", session });
}

// Before the first request, so a live session never shows as ended just after a restart.
await pollProcesses();
store.refreshStatuses();

const app = buildApp({ store, sse, onHook, processes: () => monitor.list() });
await app.listen({ host: HOST, port: PORT });
console.log(`Claude Monitor on http://${HOST}:${PORT}`);

const stopWatcher = startWatcher(PROJECTS_DIR, scanner, onIngest);
// Anything written between the boot scan and the watcher starting.
await scanner.scanAll(PROJECTS_DIR, onIngest);

setInterval(() => {
  for (const session of store.refreshStatuses()) sse.broadcast({ type: "session_updated", session });
}, STATUS_TICK_MS).unref();

setInterval(() => void pollProcesses(), PROCESS_POLL_MS).unref();

let stopping = false;
const shutdown = async (): Promise<void> => {
  if (stopping) return;
  stopping = true;
  sse.closeAll();
  await stopWatcher();
  await app.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
