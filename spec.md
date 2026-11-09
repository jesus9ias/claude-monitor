# Claude Monitor: Local Dashboard Spec (MVP)

Quick-start spec. Goal: something that works, then evolve. Not rigorous on purpose.

## 1. Goal

A local-only web dashboard (`127.0.0.1`) that shows what Claude Code is doing right now and historically:

- Sessions (active / idle / ended), model, cwd, git branch
- Token usage and estimated cost
- Tool calls, running processes, subagents
- Git state per session
- A flow diagram of session -> subagents -> tool calls

**Non-goals (for now):** claude.ai web/app chats (no local data source), auth, multi-user, remote access, persistence beyond a local cache.

## 2. Stack (defaults, change freely)

- Node 20+, TypeScript everywhere
- Server: Fastify + `chokidar` (file watching) + SSE for live updates
- Frontend: React + Vite + React Flow (`@xyflow/react`) + Recharts + `dagre` for layout
- Storage: in-memory state, rebuilt from JSONL on boot (add SQLite later if slow)
- Monorepo with npm workspaces: `server/`, `web/`, `shared/` (shared types)

```
claude-monitor/
  shared/        # types: Session, Event, Usage, GraphNode/Edge
  server/
    src/
      index.ts           # Fastify bootstrap, binds 127.0.0.1:4317
      parser/jsonl.ts    # ONLY place that knows the transcript format
      store.ts           # in-memory sessions + events
      watcher.ts         # chokidar tail of ~/.claude/projects/**/*.jsonl
      hooks.ts           # POST /event handler
      git.ts             # git status/log/worktrees per cwd
      procs.ts           # `ps` polling for claude processes
      pricing.ts + pricing.json
      sse.ts
  web/
    src/ (pages: Sessions, SessionDetail, Flow)
  scripts/install-hooks.ts   # prints/merges hook config
```

## 3. Data model (shared)

```ts
type SessionStatus = "active" | "idle" | "ended";

interface Usage { input: number; output: number; cacheRead: number; cacheCreate: number }

interface Session {
  id: string;
  cwd: string;
  gitBranch?: string;
  model?: string;
  status: SessionStatus;
  startedAt: string;
  lastEventAt: string;
  usage: Usage;            // totals
  costUsd: number;         // estimated
  usageByModel: Record<string, Usage>;
  subagents: string[];     // ids of sidechains/agents
  pid?: number;            // if matched to a live process
}

interface Event {
  id: string;              // uuid from transcript or generated
  sessionId: string;
  parentId?: string;
  ts: string;
  kind: "user" | "assistant" | "tool_use" | "tool_result" | "subagent_start" | "subagent_stop" | "hook";
  toolName?: string;
  summary: string;         // short, for the UI
  isSidechain?: boolean;
  usage?: Usage;
  model?: string;
}
```

## 4. API

- `GET /api/sessions` -> `Session[]`
- `GET /api/sessions/:id` -> `{ session, events }` (events paginated: `?before=&limit=`)
- `GET /api/sessions/:id/git` -> `{ branch, dirty, ahead, behind, recentCommits[], worktrees[] }`
- `GET /api/sessions/:id/graph` -> `{ nodes, edges }` for React Flow
- `GET /api/processes` -> live `claude` processes `{ pid, cwd, startedAt, cpu, mem }`
- `GET /api/stats?range=today|7d|30d` -> tokens/cost grouped by day and model
- `GET /stream` -> SSE: `session_updated`, `event_added`, `process_changed`
- `POST /event` -> receives Claude Code hook payloads

## 5. Phases

### Phase 1: JSONL parser -> sessions with tokens, model, cost

**Scope**
- Scan `~/.claude/projects/*/*.jsonl` on boot.
- Parse each line defensively (skip malformed lines, never crash).
- Extract per line: `sessionId`, `cwd`, `gitBranch`, `timestamp`, `uuid`, `parentUuid`, `isSidechain`, `message.model`, `message.usage`, `message.content[]` (`tool_use` / `tool_result`).
- Aggregate usage per session and per model; compute cost with `pricing.json`.
- Keep a per-file byte offset for incremental reads (used again in Phase 2).
- `pricing.json`: `{ "<model-id>": { "input": 0, "output": 0, "cacheRead": 0, "cacheCreate": 0 } }` in USD per 1M tokens. The author fills in real values; unknown model -> cost `null`, shown as "n/a".

**First task:** read 2-3 real transcript files and confirm field names before writing types. The format is undocumented and may differ from the list above; all format knowledge lives in `parser/jsonl.ts`.

**Done when**
- A CLI `npm run scan` prints a table: session id, cwd, model, input/output tokens, cost.
- Totals are plausible against a manually inspected session.
- Malformed lines do not crash it.

### Phase 2: Server + basic UI with SSE

**Scope**
- Fastify server serving the API above and the built `web/` as static files (dev: Vite proxy to 4317).
- `watcher.ts`: chokidar on the projects dir; on change, read from saved offset, parse new lines, update store, emit SSE.
- Status heuristic (v1): `active` if last event < 30 s ago, `idle` if < 15 min, else `ended`.
- UI: sessions table (status dot, project, model, tokens, cost, last activity), sorted by last activity, live updating. Session detail page with event list and a tokens-over-time chart.
- Cost-by-day bar chart on the home page.

**Done when**
- Starting a Claude Code session in another terminal makes a new row appear and its tokens tick up without refreshing.
- Server restart rebuilds the same state from disk.
- Server only listens on `127.0.0.1`.

### Phase 3: Hooks for real time and active/idle state

**Scope**
- `scripts/install-hooks.ts` prints (or, with `--write`, merges into `~/.claude/settings.json`, backing up first) a hooks block like:

```json
{
  "hooks": {
    "SessionStart": [{ "hooks": [{ "type": "command", "command": "curl -s -m 1 -X POST http://127.0.0.1:4317/event -H 'content-type: application/json' -d @- || true" }] }],
    "PreToolUse":   [{ "matcher": "*", "hooks": [{ "type": "command", "command": "curl -s -m 1 -X POST http://127.0.0.1:4317/event -H 'content-type: application/json' -d @- || true" }] }],
    "PostToolUse":  [{ "matcher": "*", "hooks": [{ "type": "command", "command": "curl -s -m 1 -X POST http://127.0.0.1:4317/event -H 'content-type: application/json' -d @- || true" }] }],
    "SubagentStop": [{ "hooks": [{ "type": "command", "command": "curl -s -m 1 -X POST http://127.0.0.1:4317/event -H 'content-type: application/json' -d @- || true" }] }],
    "Stop":         [{ "hooks": [{ "type": "command", "command": "curl -s -m 1 -X POST http://127.0.0.1:4317/event -H 'content-type: application/json' -d @- || true" }] }]
  }
}
```

  Check the current Claude Code hooks docs for exact event names and payload shape; payload arrives on stdin as JSON (`session_id`, `transcript_path`, `cwd`, `hook_event_name`, `tool_name`, `tool_input`, ...).
- `hooks.ts`: validate body loosely, map to `Event{kind:"hook"}`, update session status:
  - `PreToolUse` -> `active` + "running tool X" (current activity field)
  - `PostToolUse` -> clears current tool
  - `Stop` -> `idle`
  - `SessionStart` -> create session if missing
- Hooks must never block or slow Claude: `-m 1` timeout and `|| true`; server responds `204` immediately.
- Session card shows "currently running: <tool>" with elapsed time.

**Done when**
- Tool calls appear in the UI within ~1 s.
- Stopping the server does not break or slow Claude Code.
- Status flips active -> idle on `Stop` without waiting for the 30 s heuristic.

### Phase 4: Git and processes panels

**Scope**
- `procs.ts`: every 3 s run `ps -axo pid,etime,pcpu,rss,command`, filter `claude` processes, resolve cwd (`lsof -a -p <pid> -d cwd -Fn` on macOS / `readlink /proc/<pid>/cwd` on Linux). Match pid to session by cwd + most recent activity. Emit `process_changed` on diff.
- `git.ts`: for a session's cwd run (with 2 s timeout, cached 5 s): `git rev-parse --abbrev-ref HEAD`, `git status --porcelain=v1 -b`, `git log -n 10 --pretty=format:%h|%an|%ar|%s`, `git worktree list --porcelain`. Handle non-git dirs gracefully.
- UI: on session detail, a Git panel (branch, ahead/behind, dirty files grouped by status, last 10 commits, worktrees) and a Processes page (pid, cpu, mem, uptime, linked session). Show kill button? **No**, read-only for MVP.

**Done when**
- Editing a file in the repo shows up as dirty within ~5 s.
- A live `claude` process is linked to its session; a dead one disappears.
- Non-git directories show "not a git repo" instead of an error.

### Phase 5: Flow diagram with subagents and tools

**Scope**
- `GET /api/sessions/:id/graph` builds:
  - Node types: `session` (root), `turn` (optional, collapsed by default), `tool` (Bash, Edit, Read, ...), `subagent` (Agent tool call or sidechain).
  - Edges: parent -> child using `parentUuid`, `tool_use` -> `tool_result` pairing by `tool_use_id`, and Agent tool call -> its sidechain events.
- Node badges: duration, status (running / ok / error), tokens for assistant nodes, model for subagents.
- Frontend: React Flow with dagre top-to-bottom layout, minimap, zoom, click node -> side drawer with summary, input (truncated) and result (truncated).
- Live: new events add nodes via SSE without resetting the viewport. Running nodes pulse.
- Collapse tool calls into groups ("12 x Read") when a turn has more than ~8 of them.

**Done when**
- A session that used subagents renders as a readable tree and matches what happened in the transcript.
- Graph updates live during an active session.
- 500+ event sessions stay usable (collapsing/grouping on by default).

## 6. Run it

```
npm install
npm run dev        # server on :4317 + vite on :5173
npm run build && npm start   # single process serving built UI on :4317
npm run hooks:install        # prints hook config (add --write to merge)
```

## 7. Guardrails

- Bind `127.0.0.1` only; no CORS wildcard.
- Transcripts may contain secrets: truncate tool inputs/outputs in the UI, never log full payloads, never send data anywhere external.
- All transcript-format knowledge stays in `parser/jsonl.ts`; when Claude Code updates and breaks things, fix it there.
- Prefer incremental reads (offset per file); never reparse whole files on every change.

## 8. Later ideas (out of scope now)

SQLite history, OpenTelemetry collector input, `stats-cache.json` import, per-project cost budgets and alerts, API usage via the Admin/Usage API for non-Claude-Code traffic, export to CSV.