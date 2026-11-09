import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { GitCommit, GitFile, GitInfo, GitWorktree } from "@claude-monitor/shared";

const exec = promisify(execFile);
const TIMEOUT_MS = 2000;
const CACHE_MS = 5000;
const LOG_FIELD_SEPARATOR = "\u001f";

export class GitTimeoutError extends Error {}

/** GIT_OPTIONAL_LOCKS=0: polling must never hold a lock that makes the user's own git command fail. */
async function git(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await exec("git", ["-C", cwd, "-c", "core.quotepath=off", ...args], {
      timeout: TIMEOUT_MS,
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    });
    return stdout;
  } catch (err) {
    if ((err as { killed?: boolean }).killed) throw new GitTimeoutError(`git timed out in ${cwd}`);
    throw err;
  }
}

/** Exported for tests. Parses `git status --porcelain=v1 -b`. */
export function parseStatus(output: string): { branch: string; ahead: number; behind: number; dirty: GitFile[] } {
  const lines = output.split("\n").filter(Boolean);
  const header = lines[0]?.startsWith("## ") ? lines.shift()!.slice(3) : "";
  const branch = header
    .replace(/^No commits yet on /, "")
    .replace(/^Initial commit on /, "")
    .replace(/\.\.\..*$/, "")
    .replace(/ \[.*\]$/, "");
  return {
    branch: branch || "HEAD",
    ahead: Number(/ahead (\d+)/.exec(header)?.[1] ?? 0),
    behind: Number(/behind (\d+)/.exec(header)?.[1] ?? 0),
    dirty: lines.map((l) => ({ status: l.slice(0, 2), path: l.slice(3) })),
  };
}

/** Exported for tests. Parses `git worktree list --porcelain`. */
export function parseWorktrees(output: string): GitWorktree[] {
  const worktrees: GitWorktree[] = [];
  for (const block of output.split(/\r?\n\r?\n/)) {
    const tree: GitWorktree = { path: "" };
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith("worktree ")) tree.path = line.slice(9);
      else if (line.startsWith("HEAD ")) tree.head = line.slice(5, 12);
      else if (line.startsWith("branch ")) tree.branch = line.slice(7).replace("refs/heads/", "");
    }
    if (tree.path) worktrees.push(tree);
  }
  return worktrees;
}

function parseLog(output: string): GitCommit[] {
  return output
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [hash = "", author = "", relativeDate = "", subject = ""] = line.split(LOG_FIELD_SEPARATOR);
      return { hash, author, relativeDate, subject };
    });
}

async function read(cwd: string): Promise<GitInfo> {
  try {
    await git(cwd, ["rev-parse", "--is-inside-work-tree"]);
  } catch (err) {
    if (err instanceof GitTimeoutError) throw err;
    return { isRepo: false }; // Not a repo, a missing directory, or git not installed.
  }
  const [status, log, worktrees] = await Promise.all([
    git(cwd, ["status", "--porcelain=v1", "-b"]),
    // A repo with no commits fails here, which simply means an empty log.
    git(cwd, ["log", "-n", "10", `--pretty=format:%h${LOG_FIELD_SEPARATOR}%an${LOG_FIELD_SEPARATOR}%ar${LOG_FIELD_SEPARATOR}%s`]).catch((err) => {
      if (err instanceof GitTimeoutError) throw err;
      return "";
    }),
    git(cwd, ["worktree", "list", "--porcelain"]),
  ]);
  return { isRepo: true, ...parseStatus(status), recentCommits: parseLog(log), worktrees: parseWorktrees(worktrees) };
}

const cache = new Map<string, { at: number; value: Promise<GitInfo> }>();

export function gitInfo(cwd: string): Promise<GitInfo> {
  const hit = cache.get(cwd);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const value = read(cwd);
  cache.set(cwd, { at: Date.now(), value });
  value.catch(() => cache.delete(cwd));
  return value;
}
