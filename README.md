# Claude Monitor

A local dashboard for what Claude Code is doing now and has done: sessions, tokens and estimated cost, running tools, processes, git state, and a flow diagram of each session. It reads Claude Code's own files on your machine, listens only on `127.0.0.1`, and sends nothing anywhere.

See [spec.md](spec.md) for the original design.

## Run it

Needs Node 20 or later.

```bash
npm install
```

```bash
npm run build && npm start
```

Then open <http://127.0.0.1:4317>.

For development, with the server on 4317 and Vite on 5173:

```bash
npm run dev
```

## Hooks

Without hooks the dashboard still works, but it can only guess status from transcript activity. With them, tool calls show up within about a second and status changes at once.

```bash
npm run hooks:install
```

That only prints the config. To change `~/.claude/settings.json`, which applies to every Claude Code session on this machine:

```bash
npm run hooks:install -- --write
```

```bash
npm run hooks:install -- --uninstall
```

Both back up the file first and leave your other settings and hooks alone. The hooks run in the background and ignore failures, so a stopped monitor doesn't affect Claude Code.

## Other commands

| Command | What it does |
|---|---|
| `npm run scan` | Prints a table of sessions, tokens and cost, with no server |
| `npm run scan -- --check` | Compares estimated cost with the cost Claude Code recorded |
| `npm test` | Runs the server tests |
| `npm run typecheck` | Type-checks all packages |

## Good to know

- **Cost is an estimate.** Prices are in [server/src/pricing.json](server/src/pricing.json), in USD per million tokens, and were copied from Anthropic's pricing page on 2026-11-05. A session using a model with no price shows `n/a`.
- **Cost assumes API pricing.** On a subscription plan, read it as what the usage would cost on the API, not what you paid.
- **Tool durations can run long.** A call's time starts when it appears in the transcript. In a batch of parallel calls, that can include the time the model spent writing the later ones.
- **Hook data isn't kept across restarts.** Sessions, tokens and tool calls are rebuilt from the transcripts, but hook events and current activity are not. After a restart, status falls back to the age rule until the next hook arrives.
- **macOS and Linux are untested.** Process stats use `ps` and `lsof` or `/proc` there, and this has only been run on Windows.

## Layout

| Path | Purpose |
|---|---|
| `shared/` | Types used by the server and the UI |
| `server/src/parser/jsonl.ts` | The only code that knows the transcript format. Fix it here when Claude Code changes it |
| `server/src/hooks.ts` | The only code that knows the hook payload format |
| `web/` | The React UI |
| `scripts/install-hooks.ts` | The hook installer |
