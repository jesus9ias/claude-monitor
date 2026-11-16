import { useEffect, useState } from "react";
import type { GitFile, GitInfo } from "@claude-monitor/shared";
import { api } from "../api";
import { Icon } from "./Icon";

const POLL_MS = 5000;

type ChangeType = "conflicted" | "untracked" | "renamed" | "deleted" | "added" | "modified";

const GROUPS: { type: ChangeType; label: string; badge: string; match: (status: string) => boolean }[] = [
  { type: "conflicted", label: "Conflicted", badge: "U", match: (s) => s.includes("U") || s === "AA" || s === "DD" },
  { type: "untracked", label: "Untracked", badge: "?", match: (s) => s === "??" },
  { type: "renamed", label: "Renamed", badge: "R", match: (s) => s.includes("R") },
  { type: "deleted", label: "Deleted", badge: "D", match: (s) => s.includes("D") },
  { type: "added", label: "Added", badge: "A", match: (s) => s.includes("A") },
  { type: "modified", label: "Modified", badge: "M", match: () => true },
];

function groupFiles(files: GitFile[]) {
  const out = new Map<ChangeType, GitFile[]>();
  for (const file of files) {
    const type = GROUPS.find((g) => g.match(file.status))!.type;
    out.set(type, [...(out.get(type) ?? []), file]);
  }
  return GROUPS.filter((g) => out.has(g.type)).map((g) => ({ ...g, files: out.get(g.type)! }));
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
      <div className="git-branch">
        <span className="chip">
          <Icon name="branch" size={14} />
          <strong>{info.branch}</strong>
        </span>
        <span className={`chip ${info.ahead > 0 ? "chip-accent" : ""}`}>{info.ahead} ahead</span>
        <span className={`chip ${info.behind > 0 ? "chip-warning" : ""}`}>{info.behind} behind</span>
        <span className={`chip ${info.dirty.length > 0 ? "chip-warning" : "chip-good"}`}>
          {info.dirty.length === 0 ? "Clean" : `${info.dirty.length} uncommitted`}
        </span>
        {failed && <span className="muted small">last known state</span>}
      </div>
      <div className="git-columns">
        <div>
          <h3>Changes ({info.dirty.length})</h3>
          {info.dirty.length === 0 && <p className="empty">Working tree clean.</p>}
          {groupFiles(info.dirty).map((group) => (
            <div key={group.type} className="git-group">
              <div className="lbl">
                {group.label} ({group.files.length})
              </div>
              <ul className="git-files">
                {group.files.map((f) => (
                  <li key={f.path}>
                    <span className={`git-badge git-${group.type}`} title={group.label}>
                      {group.badge}
                    </span>
                    <span className="mono">{f.path}</span>
                  </li>
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
                <code className="hash">{c.hash}</code> {c.subject}
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
                <span className="mono">{w.path}</span> <span className="muted">{w.branch ?? w.head}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
