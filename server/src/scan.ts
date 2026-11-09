/** `npm run scan`: prints what the parser sees. `--check` compares against Claude Code's own cost. */
import { PROJECTS_DIR } from "./config.js";
import { loadPricing } from "./pricing.js";
import { Scanner } from "./scanner.js";
import { Store } from "./store.js";

const store = new Store(loadPricing());
const scanner = new Scanner(store);
const fileCount = await scanner.scanAll(PROJECTS_DIR);
const sessions = store.listSessions();

const money = (v: number | null | undefined): string => (v === null || v === undefined ? "n/a" : `$${v.toFixed(2)}`);
const int = (v: number): string => v.toLocaleString("en-US");
const tail = (s: string, n: number): string => (s.length > n ? `…${s.slice(-(n - 1))}` : s);

function printTable(rows: string[][], rightAligned: number[]): void {
  const widths = rows[0]!.map((_, i) => Math.max(...rows.map((r) => r[i]!.length)));
  for (const row of rows) {
    console.log(row.map((c, i) => (rightAligned.includes(i) ? c.padStart(widths[i]!) : c.padEnd(widths[i]!))).join("  "));
  }
}

if (process.argv.includes("--check")) {
  const rows = [["session", "estimated", "reported", "diff"]];
  let estimated = 0;
  let reported = 0;
  for (const s of sessions) {
    const r = store.get(s.id)?.reportedCostUsd;
    if (r === undefined || s.costUsd === null) continue;
    estimated += s.costUsd;
    reported += r;
    rows.push([s.id.slice(0, 8), money(s.costUsd), money(r), `${(((s.costUsd - r) / (r || 1)) * 100).toFixed(1)}%`]);
  }
  printTable(rows, [1, 2, 3]);
  console.log(`\nSessions compared: ${rows.length - 1}. Estimated ${money(estimated)}, reported ${money(reported)}.`);
} else {
  const rows = [["session", "cwd", "model", "input", "output", "cost"]];
  let cost = 0;
  let unpriced = 0;
  for (const s of sessions) {
    rows.push([s.id.slice(0, 8), tail(s.cwd, 36), s.model ?? "-", int(s.usage.input), int(s.usage.output), money(s.costUsd)]);
    if (s.costUsd === null) unpriced++;
    else cost += s.costUsd;
  }
  printTable(rows, [3, 4, 5]);
  console.log(
    `\n${sessions.length} sessions from ${fileCount} files. Estimated total ${money(cost)}` +
      `${unpriced ? ` (${unpriced} sessions n/a)` : ""}. Malformed lines skipped: ${scanner.malformedLines}.`,
  );
}
