# Overview

Claude Monitor is a local dashboard for Claude Code: it shows what every session on this machine is doing right now and what it has done.

This folder is the general spec: the real, current state of the system and the rules every change must keep. When code and spec disagree, fix one of them in the same change. Work not yet implemented lives in tickets (`specs/tickets`), never here.

## Purpose
A local, read-only dashboard over Claude Code sessions: live activity phase, tools, subagents, tokens and estimated cost, git state, processes, and the subscription's 5-hour and weekly quota.

## Scope
Everything Claude Code does on this machine is in; remote access, other users and claude.ai chats are out.

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

## Principles
Seven cross-cutting decisions that every change must keep; each is a standard as built, with its reason.

1. **Local only.** The server binds `127.0.0.1`. Requests with a foreign `Host` (DNS rebinding) or `Origin` (CSRF) get 403. No CORS headers. Why: the monitor sees every session on the machine and must never be reachable from outside it.
2. **Transcripts are the source of truth** for sessions, events and tokens. The monitor rebuilds them from disk on every start. Its own database holds only what transcripts cannot give back (see `persistence.md`). Why: no migration or sync problem can lose history that Claude Code already keeps.
3. **Secrets stay put.** Transcript content is truncated before it leaves the parser (120 characters for a summary, 1000 for a detail) and is never logged. Hook payloads are read for metadata only: prompts, tool input and messages are never read. Configuration and secrets live in `.env`, which is git-ignored; AI assistants working on this repo must never read it, and `.claude/settings.json` denies it. Why: the monitor runs beside real work and must not become a second copy of it.
4. **One module per external format.** When Claude Code or Anthropic changes a format, exactly one file changes (the table is in `architecture.md#format-modules`). Why: format churn is the main maintenance cost; it must stay contained.
5. **Never slow Claude Code.** Hooks are `async`, time out after 1 s and ignore failures. The server answers hooks with 204 before processing them. A stopped monitor changes nothing for Claude Code. Why: observation must never cost the thing observed.
6. **One outbound call, opt-in.** The only traffic leaving the machine is the quota request to `api.anthropic.com`. It happens only when a token is set in `.env`. The token goes in the `Authorization` header and nowhere else: not in logs, errors, the UI or the database. Why: a local tool should be auditable by reading one function.
7. **Incremental reads.** Each transcript keeps a byte offset; a change reads only the new bytes. A line still being written (no newline yet) waits for the next read. Why: transcripts grow to many megabytes and change every few seconds.
