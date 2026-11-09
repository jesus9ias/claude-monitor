/**
 * Prints the Claude Code hooks block for this monitor.
 *   --write      merges it into ~/.claude/settings.json, backing the file up first
 *   --uninstall  removes it from ~/.claude/settings.json, backing the file up first
 * Both are idempotent and leave every other setting and hook alone.
 */
import { copyFile, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const PORT = Number(process.env.CLAUDE_MONITOR_PORT ?? 4317);
const URL_MARKER = `http://127.0.0.1:${PORT}/event`;
const SETTINGS = path.join(process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), ".claude"), "settings.json");

/** -m 1 and `|| true` keep a stopped server harmless; async means Claude never waits on curl. */
const handler = {
  type: "command",
  shell: "bash",
  async: true,
  command: `curl -s -m 1 -o /dev/null -X POST ${URL_MARKER} -H 'content-type: application/json' --data-binary @- || true`,
};

const WITH_MATCHER = ["PreToolUse", "PostToolUse", "PostToolUseFailure"];
const WITHOUT_MATCHER = ["SessionStart", "UserPromptSubmit", "SubagentStart", "SubagentStop", "Stop", "StopFailure", "SessionEnd"];

interface HookGroup {
  matcher?: string;
  hooks?: { command?: string }[];
  [key: string]: unknown;
}
type HooksBlock = Record<string, HookGroup[]>;

function buildHooks(): HooksBlock {
  const hooks: HooksBlock = {};
  for (const name of WITHOUT_MATCHER) hooks[name] = [{ hooks: [handler] }];
  for (const name of WITH_MATCHER) hooks[name] = [{ matcher: "*", hooks: [handler] }];
  return hooks;
}

const isOurs = (group: HookGroup): boolean => group.hooks?.some((h) => h.command?.includes(URL_MARKER)) ?? false;

function removeOurs(existing: HooksBlock): HooksBlock {
  const out: HooksBlock = {};
  for (const [name, groups] of Object.entries(existing)) {
    const kept = groups.filter((g) => !isOurs(g));
    if (kept.length) out[name] = kept;
  }
  return out;
}

async function update(change: (hooks: HooksBlock) => HooksBlock): Promise<void> {
  let raw: string | null = null;
  try {
    raw = await readFile(SETTINGS, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  // A settings file we can't parse is left untouched rather than overwritten.
  const settings = raw === null ? {} : (JSON.parse(raw) as { hooks?: HooksBlock });
  const hooks = change(settings.hooks ?? {});
  if (Object.keys(hooks).length) settings.hooks = hooks;
  else delete settings.hooks;

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

const args = process.argv.slice(2);
if (args.includes("--uninstall")) {
  await update(removeOurs);
  console.log("Hooks removed. Sessions already running keep the settings they started with.");
} else if (args.includes("--write")) {
  await update((existing) => {
    const merged = removeOurs(existing);
    for (const [name, groups] of Object.entries(buildHooks())) merged[name] = [...(merged[name] ?? []), ...groups];
    return merged;
  });
  console.log("Hooks installed. They apply to Claude Code sessions started from now on.");
} else {
  console.log(JSON.stringify({ hooks: buildHooks() }, null, 2));
  console.log("\nRun with --write to merge this into your settings.");
}
