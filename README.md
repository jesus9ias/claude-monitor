# Claude Monitor

A local dashboard for Claude Code. It shows what every session is doing right now and what it has done:
- the live phase: thinking, writing, which tool, which subagents
- tokens and estimated cost
- the flow of each session
- git state
- processes
- the subscription's 5-hour and weekly quota

It reads Claude Code's own files on your machine and listens only on `127.0.0.1`. Its only outbound call is the optional quota request to Anthropic.

The design and its rules are in [spec.md](spec.md).

## Run it

Needs Node 22.13 or later.

```bash
npm install
```

```bash
npm run build && npm start
```

Then open <http://127.0.0.1:4317>.

To use another port, set `CLAUDE_MONITOR_PORT` in `.env`, run `npm run hooks:install -- --write` (add `--statusline` if you use it), and restart the monitor and any open Claude Code sessions.

For development, with the server on 4317 and Vite on 5173:

```bash
npm run dev
```

## Configure

Copy `.env.example` to `.env` and fill in what you need. Every value is optional. `.env` is git-ignored: keep it out of commits and out of any AI assistant's reach.

The Quota page (`/quota`) shows:
- what is left of each window
- the pace at which you are using it
- a 7-day history
- which sessions used the current 5-hour window

It can notify you in the browser at 20% and 5% left (`CLAUDE_MONITOR_QUOTA_ALERTS`). Each session's Pipeline tab animates where Claude is in its loop; click a block for details.

For the quota, set `CLAUDE_CODE_OAUTH_TOKEN`. Get one with `claude setup-token`:
- With a token that has the `user:profile` scope, the monitor reads the same numbers as `/usage`, for free.
- With an inference-only token, it falls back to a 1-token request whose response headers carry the numbers. That request spends a sliver of your 5-hour window.

## Hooks and statusline

Without hooks the dashboard still works, but it can only infer activity from the transcripts. With them, phase and tool changes show up within about a second.

```bash
npm run hooks:install -- --check
```

```bash
npm run hooks:install -- --write
```

Add `--statusline` to also install a statusline that feeds the quota from CLI sessions, with no token needed. It does not replace a statusline you already have.

```bash
npm run hooks:install -- --uninstall
```

Each command backs up `~/.claude/settings.json` first and leaves your other settings alone. The hooks run in the background and ignore failures, so a stopped monitor doesn't affect Claude Code. Re-run `--write` after updating the monitor if `--check` says the hooks are outdated.

## Other commands

| Command | What it does |
|---|---|
| `npm run scan` | Prints a table of sessions, tokens and cost, with no server |
| `npm run scan -- --check` | Compares estimated cost with the cost Claude Code recorded |
| `npm test` | Runs the server tests |
| `npm run typecheck` | Type-checks all packages |

## Good to know

- **Cost is an estimate at API prices.** Prices are in [server/src/domain/pricing.json](server/src/domain/pricing.json). On a subscription, read it as what the usage would cost on the API.
- **Phases are known at block boundaries.** Claude Code writes a transcript line when a block is complete, so the monitor knows when thinking, writing or a tool starts and ends, not each token.
- **State that survives restarts** (activity from hooks, quota history) is in `data/monitor.db`. Delete it to start fresh; transcripts rebuild everything else.
- **macOS and Linux are untested.** Process stats use `ps` and `lsof` or `/proc` there. It has only been run on Windows.

## Layout

| Path | Purpose |
|---|---|
| `shared/` | Types and helpers used by server and UI: activity phases, tool classifier, quota, stream protocol |
| `server/src/ingest/` | Readers of outside formats: transcripts, hooks, statusline. Fix these when Claude Code changes a format |
| `server/src/domain/` | State and rules: sessions, activity, status, quota, graph, stats, pricing |
| `server/src/infra/` | SQLite, git, processes, the Anthropic client |
| `server/src/http/` | REST routes and the event stream |
| `web/` | The React UI |
| `scripts/` | Hook and statusline installer, statusline command |
