import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { gitInfo, parseStatus, parseWorktrees } from "../src/git.js";

test("status header forms", () => {
  assert.deepEqual(parseStatus("## main...origin/main [ahead 2, behind 1]\n M a.ts\n?? b.ts\n"), {
    branch: "main",
    ahead: 2,
    behind: 1,
    dirty: [
      { status: " M", path: "a.ts" },
      { status: "??", path: "b.ts" },
    ],
  });
  assert.equal(parseStatus("## No commits yet on main\n").branch, "main");
  assert.equal(parseStatus("## feature/x\n").branch, "feature/x");
  assert.equal(parseStatus("## HEAD (no branch)\n").ahead, 0);
});

test("worktrees", () => {
  const output = "worktree /a\nHEAD 1234567890\nbranch refs/heads/main\n\nworktree /b\nHEAD abcdefabcd\ndetached\n";
  assert.deepEqual(parseWorktrees(output), [
    { path: "/a", head: "1234567", branch: "main" },
    { path: "/b", head: "abcdefa" },
  ]);
});

test("a non-git directory and a missing one report not a repo", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "monitor-git-"));
  assert.deepEqual(await gitInfo(dir), { isRepo: false });
  assert.deepEqual(await gitInfo(path.join(dir, "does-not-exist")), { isRepo: false });
});
