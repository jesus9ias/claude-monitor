# Claude Monitor: Specification

Claude Monitor is a local dashboard for Claude Code. It shows what every session is doing right now and what it has done: activity phase, tools, subagents, tokens and estimated cost, git state, processes, and the subscription's 5-hour and weekly quota.

This document is the reference for how the system works and the rules every change must keep. When code and spec disagree, fix one of them in the same change.

## 1. Scope

**In scope**

- Claude Code sessions on this machine, from any entrypoint: CLI, the Claude desktop app, SDKs.
- Live activity of each session: the phase it is in (thinking, writing, running a tool, waiting...), which tool, which subagents.
- History: sessions, events, token usage per message and model, estimated cost by day.
- Per session: a flow graph (turns, tools, subagents) and a pipeline view (where the session is in its loop).
- Subscription quota: percentage left of the 5-hour and weekly windows.
- Git state of each session's working directory, and live `claude` processes.

**Out of scope**

- claude.ai chats (no local data).
- Remote access, multiple users, authentication. The server is for the person at this machine.
- Changing anything in Claude Code beyond installing this monitor's hooks and statusline on request.

## 2. Principles

1. **Local only.** The server binds `127.0.0.1`. Requests with a foreign `Host` (DNS rebinding) or `Origin` (CSRF) get 403. No CORS headers.
2. **Transcripts are the source of truth** for sessions, events and tokens. The monitor rebuilds them from disk on every start. Its own database holds only what transcripts cannot give back (section 7).
3. **Secrets stay put.**
   - Transcript content is truncated before it leaves the parser (120 characters for a summary, 1000 for a detail) and is never logged.
   - Hook payloads are read for metadata only: prompts, tool input and messages are never read.
   - Configuration and secrets live in `.env`, which is git-ignored. AI assistants working on this repo must never read it; `.claude/settings.json` denies it.
4. **One module per external format.** When Claude Code or Anthropic changes a format, exactly one file changes:

   | Format | Module |
   |---|---|
   | Transcript JSONL | `server/src/ingest/transcript.ts` |
   | Hook payloads | `server/src/ingest/hooks.ts` |
   | Statusline payload | `server/src/ingest/statusline.ts` |
   | Anthropic quota endpoints | `server/src/infra/anthropic.ts` |
   | Live session registry (`sessions/<pid>.json`) | `server/src/infra/procs.ts` |

5. **Never slow Claude Code.** Hooks are `async`, time out after 1 s and ignore failures. The server answers hooks with 204 before processing them. A stopped monitor changes nothing for Claude Code.
6. **One outbound call, opt-in.** The only traffic leaving the machine is the quota request to `api.anthropic.com`. It happens only when a token is set in `.env`. The token goes in the `Authorization` header and nowhere else: not in logs, errors, the UI or the database.
7. **Incremental reads.** Each transcript keeps a byte offset; a change reads only the new bytes. A line still being written (no newline yet) waits for the next read.

## 3. Architecture

```
            ~/.claude/projects/**/*.jsonl      hooks (POST /event)     statusline (POST /statusline)
                        │                             │                            │
                 ingest/scanner ◄── ingest/watcher    │                            │
                        │ ParsedLine                  │ HookUpdate                 │ QuotaReading
                        ▼                             ▼                            ▼
                ┌──────────────────────── domain/monitor ───────────┐       domain/quota ◄── infra/anthropic
                │ SessionStore   ActivityTracker   computeStatus    │             │            (OAuth token)
                └───────────────────────────┬───────────────────────┘             │
                                            ▼  domain events                       ▼
                                           bus ────────────────────────────────────┤
                                  ┌─────────┴──────────┐                           │
                                  ▼                    ▼                           ▼
                           http/sse (stream)     infra/db (SQLite) ◄───────── quota samples
                                  │
                            web (React)  ◄── http/app (REST)
```

### 3.1 Packages

| Package | Role |
|---|---|
| `shared/` | Types and pure helpers used by both sides: domain types, `Activity`/`Phase`, the tool classifier, `Quota`, the stream protocol. No I/O. |
| `server/` | Node 22.13+ / TypeScript, run with `tsx`. Fastify, chokidar, `node:sqlite`. |
| `web/` | React 18, React Router, Recharts, React Flow and dagre (loaded only by the Flow tab). Built by Vite, served by the server. |
| `scripts/` | Hook and statusline installer, statusline command. |

### 3.2 Server layers

| Folder | Holds | May depend on |
|---|---|---|
| `ingest/` | Format parsers and file readers: turn outside data into `ParsedLine`, `HookUpdate`, `QuotaReading`. | `shared`, `domain` types |
| `domain/` | State and rules: `SessionStore`, `ActivityTracker`, `computeStatus`, `Monitor`, `QuotaService`, graph and stats builders, pricing. No file, process or network access. | `shared`, `bus`, `infra/anthropic` types |
| `infra/` | Side effects: SQLite, git, processes, the Anthropic client. | `shared` |
| `http/` | REST routes and the SSE hub. Thin: no rules. | all of the above |
| `bus.ts` | Typed in-process domain events. | `shared` |
| `index.ts` | Composition root. Builds and wires; no logic. | everything |

`Monitor` is the single entry point that changes session state. Ingest calls `ingestLines`, `applyHook` and `applyProcesses`, and a 5 s `tick`. After each change `Monitor` recomputes status and activity and emits domain events. Nothing else emits session events.

## 4. Data sources

### 4.1 Transcripts

The layout, with `<config>` being `CLAUDE_CONFIG_DIR` or `~/.claude`:

```
<config>/projects/<encoded-cwd>/<sessionId>.jsonl
<config>/projects/<encoded-cwd>/<sessionId>/subagents/agent-<agentId>.jsonl   (+ .meta.json)
```

| Line | Used for |
|---|---|
| `user` | Prompts (`isMeta` lines skipped), `tool_result` blocks, subagent links (`toolUseResult.agentId`). Also `cwd`, `gitBranch` and `entrypoint`. |
| `assistant` | `text` / `thinking` / `tool_use` blocks, `message.model`, `message.usage`. One API message spans several lines that repeat the same `message.id` and usage, so it is counted once, with the latest usage. `<synthetic>` messages count no tokens. |
| `api-request` | Marker: a request to the model went out. |
| `system` / `compact_boundary` | Marker: compaction finished (`compactMetadata.durationMs`). |
| `system` / `stop_hook_summary` | Marker: the turn ended. |
| `system` / `api_error` | Marker, recorded only. |
| `custom-title`, `ai-title` | Session title. A custom title wins over an AI one. |
| `cost-state` | Claude Code's own cost total. Used only by `npm run scan -- --check`. |
| Anything else | Ignored. |

Malformed lines are skipped and counted, and never crash the server. A 10 s sweep catches any changes the file watcher misses.

### 4.2 Hooks

The installer subscribes every event below to `POST /event`. Each one becomes an activity signal (section 6):

| Hook | Signal |
|---|---|
| `SessionStart` | start |
| `UserPromptSubmit` | prompt |
| `PreToolUse` | tool_start |
| `PostToolUse`, `PostToolUseFailure`, `PermissionDenied` | tool_end |
| `PermissionRequest`, `Elicitation` | permission |
| `Notification` | by `notification_type`: `permission_prompt` or `elicitation_dialog` → permission; `idle_prompt` → waiting_input |
| `PreCompact` / `PostCompact` | compact_start / compact_end |
| `SubagentStart` / `SubagentStop` | agent_start / agent_stop |
| `Stop`, `StopFailure` | stop |
| `SessionEnd` | end |

A hook with an `agent_id` comes from a subagent. It only marks that agent as running, and never changes the session's phase or current tool.

### 4.3 Live session registry

`<config>/sessions/<pid>.json` holds `{ pid, sessionId, cwd, startedAt }`. An entry counts only when the OS confirms that pid is a running `claude` process. That check is `Get-Process` on Windows, and `ps` plus `lsof` or `/proc` elsewhere. It is polled every 3 s.

### 4.4 Quota

| Source | How | Notes |
|---|---|---|
| `usage` | `GET https://api.anthropic.com/api/oauth/usage`, with `Authorization: Bearer <token>` and `anthropic-beta: oauth-2025-04-20`. | Free. Needs the `user:profile` scope. `utilization` is a percentage and `resets_at` an ISO date. Gives `five_hour`, `seven_day`, and `seven_day_opus` / `seven_day_sonnet` when the plan has them. |
| `probe` | `POST /v1/messages`: 1 output token to `CLAUDE_MONITOR_QUOTA_PROBE_MODEL`, with Claude Code's system prompt. | Works with inference-only tokens (`claude setup-token`). Reads the `anthropic-ratelimit-unified-{5h,7d}-utilization` headers (a 0-1 fraction) and the matching `-reset` headers (Unix seconds). A 429 still yields a reading. Spends a sliver of the 5-hour window. |
| `statusline` | Claude Code pipes statusline JSON to `scripts/statusline.mjs`, which posts `rate_limits` to `POST /statusline`. | Push, free, no token. Only fires where a statusline is rendered. |

`CLAUDE_MONITOR_QUOTA_SOURCE=auto` tries `usage` first. On a 403 it switches to `probe` for the rest of the run. Refresh runs every `CLAUDE_MONITOR_QUOTA_INTERVAL` seconds (minimum 60) while any session is active, and four times less often when none is. Whichever reading is newest wins, from either feed.

## 5. Domain model

The exact shapes live in `shared/src`. The rules here are what those types mean.

- **Session**: id, cwd, git branch, model, `entrypoint`, `status`, `activity`, usage totals and per model, estimated cost, subagent ids, linked pid. A session with no cwd yet is hidden from the list but can still be reached by URL.
- **Event**: one thing in a session's history. Kinds: `user`, `assistant`, `thinking`, `tool_use`, `tool_result`, `subagent_start`, `subagent_stop`, `hook`. Each event has a short `summary`; tool events also carry a truncated `detail`. Subagent events have `agentId` and `isSidechain`.
- **Activity**: `{ phase, since, tool?, agents[], source }`.
- **Phase**: `waiting_input`, `requesting`, `thinking`, `writing`, `tool`, `waiting_permission`, `compacting` or `ended`.
- **Tool category** (`shared/src/tools.ts`): `read`, `search`, `edit`, `shell`, `mcp` (parsed from `mcp__<server>__<tool>`), `skill`, `agent`, `web`, `planning` or `other`. The server and the UI use this one classifier.
- **Quota**: `{ status: not_configured | ok | error, source, fetchedAt, fiveHour, sevenDay, sevenDayByModel }`. Each window is `{ usedPct, resetsAt }`. On an error the last good windows are kept.
- **Cost**: per API message, with the prices in `server/src/domain/pricing.json` (USD per 1M tokens). It separates 5-minute and 1-hour cache writes, and applies long-prompt tiers and the fast-mode multiplier. A model with no price makes the session's cost `null` (shown as "n/a"). Cost is what the usage would cost on the API, not what a subscription charges.

## 6. Activity and status

### 6.1 Signals

Hooks and transcript lines both become signals. Transcript signals:

| Transcript | Signal |
|---|---|
| user prompt | prompt |
| `api-request` | request |
| thinking block | thinking |
| text block | writing |
| `tool_use` block | tool_start |
| `tool_result` | tool_end |
| `stop_hook_summary` | stop |
| `compact_boundary` | compact_end |
| subagent transcript appears | agent_start |

Each signal moves the phase:

| Signal | Phase |
|---|---|
| prompt, request, tool_end, compact_end | `requesting` |
| thinking | `thinking` |
| writing | `writing` |
| tool_start | `tool` (with the classified tool) |
| permission | `waiting_permission` |
| start, waiting_input, stop | `waiting_input` |
| compact_start | `compacting` |
| end | `ended` |

Rules:

1. **Order.** A signal older than the current phase's `since` never changes the phase. Hooks arrive within milliseconds, but a transcript line is written only when its block is complete. This rule keeps a late text line from undoing a `Stop`.
2. **Parallel tools.** The end of one tool call does not end another call that is still running.
3. **Overtaking.** A `PostToolUse` can arrive before its `PreToolUse`. A tool already finished is never shown as running.
4. **Subagents** are tracked in `agents[]`. The main loop's phase stays `tool` (category `agent`) while the Agent call runs.
5. **Expiry.** A tool with no end after 15 minutes is dropped.
6. **View.** The shown activity depends on the session's status. A working phase in an `idle` session is shown as `waiting_input`, and an `ended` session as `ended`.

The transcript only marks the boundaries between blocks. Token-by-token progress is never observed, so any animation inside a phase is simulated by the UI.

### 6.2 Status

Rules apply in this order; the first that matches wins:

1. A running tool → `active`.
2. `waiting_permission` → `idle`.
3. `SessionEnd`, with no later activity (2 s grace) → `ended`.
4. No live process and no activity for 15 minutes → `ended`.
5. `Stop`, with no later activity (2 s grace) → `idle`.
6. Activity in the last 30 s → `active`.
7. Otherwise → `idle`.

## 7. Persistence

SQLite at `<CLAUDE_MONITOR_DATA_DIR>/monitor.db` (default `./data/`, git-ignored), using `node:sqlite` in WAL mode. The schema is versioned in `meta.schema_version`, and migrations live in `infra/db.ts`.

| Table | Holds | Lifetime |
|---|---|---|
| `activity` | Per-session tracker snapshot: phase, since, tool, agents, stop and end times. Written in 2 s batches. | Rows untouched for 30 days are deleted at start. |
| `quota_samples` | Every good quota reading. | Kept, for history. |

On start, saved activity is restored before transcripts are scanned, so rule 6.1.1 keeps what hooks said. The database never holds transcript content.

## 8. Interfaces

### 8.1 REST

| Method and path | Returns |
|---|---|
| `GET /api/meta` | `{ protocolVersion, quotaConfigured, quotaAlerts }` |
| `GET /api/sessions` | `Session[]`, most recent first |
| `GET /api/sessions/:id?before=&limit=` | `{ session, events, nextBefore, usageSeries }`. Events are paged (default 200, max 1000). |
| `GET /api/sessions/:id/graph?group=0` | `{ nodes, edges }` for the flow graph. Grouping of repeated tools is on by default. |
| `GET /api/sessions/:id/git` | Branch, ahead/behind, dirty files, last 10 commits, worktrees, or `{ isRepo: false }`. 2 s timeout, 5 s cache. |
| `GET /api/processes` | Live `claude` processes `{ pid, cwd, startedAt, cpu, mem, sessionId }` |
| `GET /api/stats?range=today\|7d\|30d` | Tokens and cost per local day and model |
| `GET /api/sessions/:id/pipeline` | `PipelineStats`: counts per block of the loop, recent calls per tool category, MCP servers, subagents, context size, and the last turn's phases for the replay |
| `GET /api/quota` | `Quota` |
| `GET /api/quota/history?days=7` | `QuotaSample[]` from `quota_samples` (1-90 days) |
| `GET /api/quota/attribution?since=<ISO>` | Each session's tokens and estimated cost since that time, heaviest first |
| `POST /api/quota/refresh` | Forces a pull. 409 when not configured. |
| `POST /event` | Hook payload. Answers 204 at once. |
| `POST /statusline` | Statusline payload. Answers 204 at once. |

### 8.2 Stream

`GET /stream` is Server-Sent Events. Every message is `{ type, ... }`, with the SSE event name equal to `type`:

| Type | Payload | When |
|---|---|---|
| `hello` | `{ version }` | On connect. A client built for another `PROTOCOL_VERSION` reloads, at most once a minute. |
| `session_updated` | `{ session }` | Any change to a visible session. |
| `event_added` | `{ event }` | A new event. |
| `activity_changed` | `{ sessionId, activity }` | The shown activity changed. Light enough for animation. |
| `process_changed` | `{ processes }` | The process list changed. |
| `quota_updated` | `{ quota }` | A new reading, or an error. |

A 20 s comment heartbeat keeps proxies from closing the stream. After a reconnect, clients refetch what they show. Any change in message shape bumps `PROTOCOL_VERSION`.

## 9. User interface

All text in the UI is in English. The layout is responsive down to 375 px, follows the system light or dark theme, and respects reduced motion.

- **Top bar**: navigation (Sessions, Processes, Quota) and the quota readout: percentage left of the 5-hour and weekly windows, colored by level, with the reset time and source in a tooltip. When there is no data it shows "Quota not configured". It links to the Quota page.
- **Quota** (`/quota`):
  - One card per window (5-hour, weekly): percentage left, a level label (OK, getting low, almost out), a meter of the used part, and the reset countdown.
  - **Pace**: a least-squares line over the window's readings since its last reset. The 5-hour window looks back 1 hour, the weekly window 24 hours. The card says when the window runs out at that rate and whether that comes before the reset. It needs at least two readings 5 minutes apart, and it is labelled as an estimate.
  - Weekly windows per model, when the plan has them.
  - History: used % of both windows over 7 days. A drop of more than 10 points in the 5-hour window is drawn as a reset. A table view is available.
  - **Who used the current 5-hour window**: each session's share since the window started (reset time minus 5 hours), weighted by estimated API cost. Anthropic does not say how tokens map to quota percent, so this is a relative split.
  - Alerts: the thresholds in use and a button to allow browser notifications. `useQuotaAlerts` (mounted at the app root) notifies once per window, reset and threshold, choosing the lowest threshold crossed. It only fires while a monitor tab is open.
- **Sessions**: range picker (today, 7 days, 30 days), tiles (cost, tokens, active now), cost by day per model, and the session table (status, activity, project, model, tokens, cost, last activity). It updates live.
- **Processes**: live `claude` processes and the session each one belongs to. Read-only.
- **Session** (`/sessions/:id/:tab`): the header shows title, cwd, branch, model, entrypoint, pid, status and the live activity. Tabs:
  - **Overview**: usage tiles, tokens over time, git panel, usage by model.
  - **Events**: paged event list, newest first. Hook events are hidden unless shown; clicking a row expands its truncated detail.
  - **Flow**: graph of turns → tools and subagents, laid out by dagre. More than 8 calls in a turn fold into groups ("12 x Read"). Containers expand and collapse; clicking a node opens a drawer with status, duration, tokens, model, and the truncated input and result. It updates live without moving the viewport, and running nodes pulse.
  - **Pipeline**: a fixed SVG diagram of the session's loop. The geometry and the phase → animation mapping live in `web/src/pages/session/pipeline/layout.ts`, as pure code.
    - **Blocks**: You, Model, Output, Context, Tool router, Needs input, and one block per tool category (Read files, Search, Write code, Shell, Web, MCP, Skill, Subagents, Planning, Other). Each shows a session counter. Context has a fill bar against the model's context window, from `server/src/domain/models.json`; a session seen above its window is taken to run the 1M-token variant.
    - **Animation**: the blocks for the current phase light up, and particles run along the edges in use. Requesting animates You → Model, Router → Model after a tool, or Context → Model after compaction. Thinking pulses Model and draws from Context. Writing animates Model → Output. A tool animates Model → Router → its category, and MCP shows the server. A permission prompt animates Router → Needs input, and compaction pulses Context. Running subagents pulse Subagents.
    - **Reduced motion**: blocks are still highlighted, but nothing moves.
    - **Drawer**: clicking a block opens a drawer with the current call, counts, average and last duration, totals per tool, per MCP server or per subagent, and the last 20 calls.
    - **Replay**: when the session is not active, "Replay last turn" plays the last turn's phases at 4x speed, each step held between 350 ms and 2 s. A session that becomes active ends the replay.
    - **Live data**: the counters reload, debounced, on `event_added`. The phase comes from the session's live activity.
    - Below 600 px the diagram scrolls horizontally inside its card.

Client state: `web/src/state/live.ts` holds the session list, quota and meta for the whole app, kept current from the stream. Data used by only one page (events, graph, usage series) stays in that page.

## 10. Configuration

`.env` at the repo root (template: `.env.example`). Variables already set in the environment take precedence. Every variable is optional.

| Variable | Default | Meaning |
|---|---|---|
| `CLAUDE_MONITOR_PORT` | `4317` | Server port. Also read by the installer, which bakes it into the hooks and the statusline command, and by Vite's proxy |
| `CLAUDE_MONITOR_WEB_PORT` | `5173` | Vite dev server port (`npm run dev`) |
| `CLAUDE_CONFIG_DIR` | `~/.claude` | Claude Code config dir |
| `CLAUDE_MONITOR_PROJECTS_DIR` | `<config>/projects` | Transcripts |
| `CLAUDE_MONITOR_SESSIONS_DIR` | `<config>/sessions` | Live session registry |
| `CLAUDE_MONITOR_DATA_DIR` | `./data` | SQLite database |
| `CLAUDE_CODE_OAUTH_TOKEN` | unset | Subscription OAuth token, for the quota |
| `CLAUDE_MONITOR_QUOTA_SOURCE` | `auto` | `auto`, `usage`, `probe` or `off` |
| `CLAUDE_MONITOR_QUOTA_INTERVAL` | `300` | Seconds between refreshes while active (minimum 60) |
| `CLAUDE_MONITOR_QUOTA_PROBE_MODEL` | `claude-haiku-5-5` | Model for the probe |
| `CLAUDE_MONITOR_QUOTA_ALERTS` | `20,5` | Percent left that triggers a browser notification. `off` disables them |
| `CLAUDE_MONITOR_ENV_FILE` | `./.env` | Alternative env file |

## 11. Operations

```
npm install
npm run build && npm start        # UI and API on http://127.0.0.1:4317
npm run dev                       # server :4317 + Vite :5173 with proxy
npm run hooks:install             # print the hooks block
npm run hooks:install -- --write [--statusline]   # merge into ~/.claude/settings.json (backup first)
npm run hooks:install -- --check  # installed config up to date?
npm run hooks:install -- --uninstall
npm run scan [-- --check]         # CLI table; --check compares cost with Claude Code's own
npm test                          # server tests
npm run typecheck                 # all packages
```

The installer only touches what it added. It finds its hooks by their `curl … http://127.0.0.1:<port>/event` command on any port, and its statusline by a marker. So after a port change, `--write` moves everything to the new port, and `--check` reports hooks or a statusline that point elsewhere. It does not overwrite an existing statusline; it explains how to forward that one to the monitor instead.

## 12. Planned features

Each feature gets its detailed design here before it is built.

None agreed yet. Each new feature is described here before it is built, then moved into the sections above when it ships.

## 13. Testing

- `server/test/*.test.ts` with `node:test`.
- Parsers are tested with synthetic lines, including malformed ones. Tests also prove that payload content never reaches events and that the token never reaches a `Quota`.
- Activity and status are driven through `Monitor` with fixed clocks, covering hook order, late transcript lines, parallel and overtaking tools, subagents, permission prompts and compaction.
- Quota is tested with a fake `fetch`: usage, the 403 → probe fallback, 429, network errors, and statusline readings. Pace projection, alert selection and attribution are tested as pure functions.
- Pipeline aggregates and the replay steps are tested from synthetic events and transcript lines.
- The database is tested in memory.
- No test touches the network, the real `~/.claude`, or `.env`.
