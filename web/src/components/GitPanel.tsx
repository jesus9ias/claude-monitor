import { useEffect, useState } from "react";
import type { GitFile, GitInfo } from "@claude-monitor/shared";
import { api } from "../api";

const POLL_MS = 5000;

const GROUPS: { label: string; match: (status: string) => boolean }[] = [
  { label: "Conflicted", match: (s) => s.includes("U") || s === "AA" || s === "DD" },
  { label: "Untracked", match: (s) => s === "??" },
  { label: "Renamed", match: (s) => s.includes("R") },
  { label: "Deleted", match: (s) => s.includes("D") },
  { label: "Added", match: (s) => s.includes("A") },
  { label: "Modified", match: () => true },
];

function groupFiles(files: GitFile[]): { label: string; files: GitFile[] }[] {
  const out = new Map<string, GitFile[]>();
  for (const file of files) {
    const label = GROUPS.find((g) => g.match(file.status))!.label;
    out.set(label, [...(out.get(label) ?? []), file]);
  }
  return GROUPS.filter((g) => out.has(g.label)).map((g) => ({ label: g.label, files: out.get(g.label)! }));
}

export function GitPanel({ sessionId }: { sessionId: string }) {
  const [info, setInfo] = useState<GitInfo | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = (): void => {
      api
        .git(sessionId)
        .then((next) => {
          if (cancelled) return;
          setInfo(next);
          setFailed(false);
        })
        .catch(() => {
          if (!cancelled) setFailed(true);
        });
    };
    load();
    const id = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [sessionId]);

  if (!info) return <p className="empty">{failed ? "Git information is unavailable." : "Loading…"}</p>;
  if (!info.isRepo) return <p className="empty">Not a git repo.</p>;

  return (
    <div className="git">
      <p className="git-branch">
        <strong>{info.branch}</strong>
        <span className="muted">
          {" "}
          {info.ahead} ahead, {info.behind} behind
        </span>
        {failed && <span className="muted"> · last known state</span>}
      </p>
      <div className="git-columns">
        <div>
          <h3>Changes ({info.dirty.length})</h3>
          {info.dirty.length === 0 && <p className="empty">Working tree clean.</p>}
          {groupFiles(info.dirty).map((group) => (
            <div key={group.label} className="git-group">
              <div className="muted">
                {group.label} ({group.files.length})
              </div>
              <ul>
                {group.files.map((f) => (
                  <li key={f.path}>{f.path}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div>
          <h3>Recent commits</h3>
          {info.recentCommits.length === 0 && <p className="empty">No commits yet.</p>}
          <ul className="commits">
            {info.recentCommits.map((c) => (
              <li key={c.hash}>
                <code>{c.hash}</code> {c.subject}
                <div className="muted small">
                  {c.author}, {c.relativeDate}
                </div>
              </li>
            ))}
          </ul>
          <h3>Worktrees ({info.worktrees.length})</h3>
          <ul>
            {info.worktrees.map((w) => (
              <li key={w.path}>
                {w.path} <span className="muted">{w.branch ?? w.head}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
