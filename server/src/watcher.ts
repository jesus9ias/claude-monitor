import chokidar from "chokidar";
import type { IngestListener, Scanner } from "./scanner.js";

/** Catches anything file events miss. Cheap: unchanged files cost one stat and no read. */
const SWEEP_MS = 10_000;

export function startWatcher(root: string, scanner: Scanner, onIngest: IngestListener): () => Promise<void> {
  const watcher = chokidar.watch(root, {
    ignoreInitial: true,
    ignored: (p, stats) => Boolean(stats?.isFile()) && !p.endsWith(".jsonl"),
  });
  const onFile = (file: string): void => {
    scanner.readNew(file, onIngest).catch((err: unknown) => {
      // The path and message only: never a line of transcript content.
      console.error(`Failed to read ${file}: ${err instanceof Error ? err.message : "unknown error"}`);
    });
  };
  watcher.on("add", onFile).on("change", onFile);
  watcher.on("error", (err) => console.error(`Watcher error: ${err instanceof Error ? err.message : "unknown"}`));

  const sweep = setInterval(() => void scanner.scanAll(root, onIngest).catch(() => undefined), SWEEP_MS);
  sweep.unref();

  return async () => {
    clearInterval(sweep);
    await watcher.close();
  };
}
