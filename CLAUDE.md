# claude-monitor

Local dashboard for Claude Code sessions: live activity, tokens and cost, git state, processes and subscription quota. What the system does lives in the general spec (`specs/general/`, start at `specs/INDEX.md`). This file is how to work here.

@specs/FLOW.md

## Commands

```
npm run dev          # server on :4317 + Vite on :5173 (ports from .env)
npm run build        # typecheck web and server, build the UI
npm start            # serve UI and API from the server
npm test             # server tests (node:test)
npm run typecheck    # all three packages
npm run scan         # CLI table of sessions; -- --check compares cost with Claude Code's
npm run hooks:install   # print the hooks block; -- --write merges it into ~/.claude/settings.json
```

Node 22.13+. TypeScript ESM everywhere, run with `tsx`; no build step for the server.

## Layout

| Path | Purpose |
|---|---|
| `shared/src/` | Types and pure helpers used by server and UI. No I/O. |
| `server/src/ingest/` | Parsers of outside formats: transcripts, hooks, statusline. |
| `server/src/domain/` | State and rules. No file, process or network access. `Monitor` is the only thing that changes session state. |
| `server/src/infra/` | SQLite, git, processes, the Anthropic client. |
| `server/src/http/` | REST routes and the SSE hub. Thin. |
| `server/test/` | `*.test.ts` with `node:test`. |
| `web/src/` | React UI: `pages/`, `components/`, `state/live.ts` (app-wide live data), `styles/`. |
| `scripts/` | Hook and statusline installer, statusline command. |

Subprojects for tickets: `shared`, `server`, `web`.

## Conventions

- **One module per external format.** A Claude Code or Anthropic format change touches exactly one file; the table is in `specs/general/architecture.md#format-modules`.
- **Layer rules** are in `specs/general/architecture.md#server-layers`. Keep `domain/` free of side effects and `http/` free of rules.
- **Stream protocol.** Any change to a stream message shape bumps `PROTOCOL_VERSION` in `shared`.
- **Prices and models** are data: `server/src/domain/pricing.json` and `server/src/domain/models.json`.
- **Tests.** Plain-English test names. Put the spec scenario's tag in a comment right above the test (`// @sc-<id>`), so `node specs/.flow/flow.mjs drift` can link them. Fixed clocks, synthetic lines, fake `fetch`, in-memory SQLite; never the network, the real `~/.claude`, or `.env`.
- **UI strings are English.** Layout works down to 375 px, follows the system theme, respects reduced motion.
- **The web package has no automated tests.** Verify UI changes by running `npm run dev` and looking.

## Secrets and privacy

- Never read, print or edit `.env`; `.claude/settings.json` denies it. Document new variables in `.env.example` and in `specs/general/configuration.md`.
- Transcript and hook content is truncated at the parser and never logged. Keep it that way in new code.
- The OAuth token goes in the `Authorization` header and nowhere else.

## Gotchas

- Only Windows has been run. The `ps`/`lsof`/`/proc` paths in `infra/procs.ts` are untested.
- The SQLite database in `data/` is git-ignored and disposable; everything but activity snapshots and quota history is rebuilt from transcripts on start.
- Transcript lines are written only when a block completes, so hooks are always earlier than the matching line; the order rule in `specs/general/activity-and-status.md#phases` depends on that.
