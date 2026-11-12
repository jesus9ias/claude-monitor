/**
 * Prints or installs the Claude Code configuration for this monitor.
 *   (no flag)     prints the hooks block
 *   --write       merges the hooks into ~/.claude/settings.json, backing the file up first
 *   --statusline  with --write: also installs the statusline feed (quota for CLI sessions)
 *   --check       says whether what is installed matches this version
 *   --uninstall   removes everything this script added, backing the file up first
 * All are idempotent and leave every other setting and hook alone.
 */
import { copyFile, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvFile, readConfig } from "../server/src/config.js";
import { HOOK_EVENTS_WITH_MATCHER, HOOK_EVENTS_WITHOUT_MATCHER } from "../server/src/ingest/hooks.js";

// Same configuration as the server: `.env` first, real environment variables win.
loadEnvFile();
const config = readConfig();
const PORT = config.port;
const URL_MARKER = `http://127.0.0.1:${PORT}/event`;
/** Our hooks on any port, so a port change replaces them instead of leaving stale copies. */
const OUR_HOOK = /curl\b.*http:\/\/127\.0\.0\.1:(\d+)\/event\b/;
const STATUSLINE_SCRIPT = fileURLToPath(new URL("./statusline.mjs", import.meta.url));
const STATUSLINE_MARKER = "claude-monitor";
const SETTINGS = path.join(config.claudeDir, "settings.json");

/** -m 1 and `|| true` keep a stopped server harmless; async means Claude never waits on curl. */
const handler = {
  type: "command",
  shell: "bash",
  async: true,
  command: `curl -s -m 1 -o /dev/null -X POST ${URL_MARKER} -H 'content-type: application/json' --data-binary @- || true`,
};

const statusLine = {
  type: "command",
  // The port is baked in: Claude Code runs this without the monitor's environment.
  command: `node "${STATUSLINE_SCRIPT.replace(/\\/g, "/")}" --port ${PORT} # ${STATUSLINE_MARKER}`,
};

interface HookGroup {
  matcher?: string;
  hooks?: { command?: string }[];
  [key: string]: unknown;
}
type HooksBlock = Record<string, HookGroup[]>;
interface Settings {
  hooks?: HooksBlock;
  statusLine?: { command?: string; [key: string]: unknown };
  [key: string]: unknown;
}

function buildHooks(): HooksBlock {
  const hooks: HooksBlock = {};
  for (const name of HOOK_EVENTS_WITHOUT_MATCHER) hooks[name] = [{ hooks: [handler] }];
  for (const name of HOOK_EVENTS_WITH_MATCHER) hooks[name] = [{ matcher: "*", hooks: [handler] }];
  return hooks;
}

const hookPort = (group: HookGroup): number | undefined => {
  for (const h of group.hooks ?? []) {
    const m = h.command ? OUR_HOOK.exec(h.command) : null;
    if (m) return Number(m[1]);
  }
  return undefined;
};
const isOurs = (group: HookGroup): boolean => hookPort(group) !== undefined;
const statusLinePort = (s: Settings["statusLine"]): number | undefined => {
  const m = s?.command ? /--port (\d+)/.exec(s.command) : null;
  // Installed before the port was baked in: it always used the default.
  return m ? Number(m[1]) : 4317;
};
const isOurStatusLine = (s: Settings["statusLine"]): boolean => Boolean(s?.command?.includes(STATUSLINE_MARKER));

function removeOurs(existing: HooksBlock): HooksBlock {
  const out: HooksBlock = {};
  for (const [name, groups] of Object.entries(existing)) {
    const kept = groups.filter((g) => !isOurs(g));
    if (kept.length) out[name] = kept;
  }
  return out;
}

async function readSettings(): Promise<{ raw: string | null; settings: Settings }> {
  let raw: string | null = null;
  try {
    raw = await readFile(SETTINGS, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  // A settings file we can't parse is left untouched rather than overwritten.
  return { raw, settings: raw === null ? {} : (JSON.parse(raw) as Settings) };
}

async function update(change: (settings: Settings) => void): Promise<void> {
  const { raw, settings } = await readSettings();
  change(settings);
  if (settings.hooks && !Object.keys(settings.hooks).length) delete settings.hooks;

  if (raw !== null) {
    const backup = `${SETTINGS}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    await copyFile(SETTINGS, backup);
    console.log(`Backup: ${backup}`);
  }
  const temp = `${SETTINGS}.tmp-${process.pid}`;
  await writeFile(temp, `${JSON.stringify(settings, null, 2)}\n`);
  await rename(temp, SETTINGS);
  console.log(`Updated: ${SETTINGS}`);
}

async function check(): Promise<void> {
  const { settings } = await readSettings();
  const ours = Object.entries(settings.hooks ?? {}).flatMap(([name, groups]) => groups.filter(isOurs).map((g) => ({ name, port: hookPort(g)! })));
  const installed = new Set(ours.map((h) => h.name));
  const ports = [...new Set(ours.map((h) => h.port))];
  const wanted = [...HOOK_EVENTS_WITHOUT_MATCHER, ...HOOK_EVENTS_WITH_MATCHER];
  const missing = wanted.filter((n) => !installed.has(n));
  const extra = [...installed].filter((n) => !wanted.includes(n));
  const wrongPort = ports.filter((p) => p !== PORT);
  console.log(`Monitor port: ${PORT}.`);
  if (!installed.size) console.log("Hooks: not installed.");
  else if (wrongPort.length) console.log(`Hooks: point to port ${wrongPort.join(", ")}. Run with --write to move them to ${PORT}.`);
  else if (!missing.length && !extra.length) console.log("Hooks: up to date.");
  else console.log(`Hooks: outdated.${missing.length ? ` Missing: ${missing.join(", ")}.` : ""}${extra.length ? ` Obsolete: ${extra.join(", ")}.` : ""} Run with --write.`);
  const sl = settings.statusLine;
  if (isOurStatusLine(sl)) {
    const p = statusLinePort(sl);
    console.log(p === PORT ? "Statusline feed: installed." : `Statusline feed: points to port ${p}. Run with --write --statusline to move it to ${PORT}.`);
  } else {
    console.log(`Statusline feed: ${sl ? "not installed (another statusline is set)" : "not installed"}.`);
  }
}

const args = process.argv.slice(2);
if (args.includes("--check")) {
  await check();
} else if (args.includes("--uninstall")) {
  await update((s) => {
    s.hooks = removeOurs(s.hooks ?? {});
    if (isOurStatusLine(s.statusLine)) delete s.statusLine;
  });
  console.log("Removed. Sessions already running keep the settings they started with.");
} else if (args.includes("--write")) {
  const wantStatusLine = args.includes("--statusline");
  await update((s) => {
    const merged = removeOurs(s.hooks ?? {});
    for (const [name, groups] of Object.entries(buildHooks())) merged[name] = [...(merged[name] ?? []), ...groups];
    s.hooks = merged;
    if (wantStatusLine) {
      if (s.statusLine && !isOurStatusLine(s.statusLine)) {
        console.log(
          "A statusline is already configured, so it was left alone. To feed the quota from it, have your\n" +
            `script also pipe its stdin to: curl -s -m 1 -X POST http://127.0.0.1:${PORT}/statusline -H 'content-type: application/json' --data-binary @-`,
        );
      } else {
        s.statusLine = statusLine;
      }
    }
  });
  console.log("Installed. It applies to Claude Code sessions started from now on.");
} else {
  console.log(`Monitor port: ${PORT} (CLAUDE_MONITOR_PORT in .env).\n`);
  console.log(JSON.stringify({ hooks: buildHooks() }, null, 2));
  console.log("\nRun with --write to merge this into your settings (add --statusline for the quota feed).");
}
