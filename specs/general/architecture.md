# Architecture

Three npm workspaces (`shared`, `server`, `web`) plus installer scripts; the server ingests transcripts, hooks and quota readings into one `Monitor`, which emits domain events to SQLite, the SSE stream and the REST API.

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

## Packages
Four top-level folders, each with one role.

| Package | Role |
|---|---|
| `shared/` | Types and pure helpers used by both sides: domain types, `Activity`/`Phase`, the tool classifier, `Quota`, the stream protocol. No I/O. |
| `server/` | Node 22.13+ / TypeScript, run with `tsx`. Fastify, chokidar, `node:sqlite`. |
| `web/` | React 18, React Router, Recharts, React Flow and dagre (loaded only by the Flow tab). Built by Vite, served by the server. |
| `scripts/` | Hook and statusline installer, statusline command. |

## Server layers
Dependencies point inward: `ingest` and `http` depend on `domain`, `domain` has no side effects, `infra` holds them, `index.ts` wires everything.

| Folder | Holds | May depend on |
|---|---|---|
| `ingest/` | Format parsers and file readers: turn outside data into `ParsedLine`, `HookUpdate`, `QuotaReading`. | `shared`, `domain` types |
| `domain/` | State and rules: `SessionStore`, `ActivityTracker`, `computeStatus`, `Monitor`, `QuotaService`, graph and stats builders, pricing. No file, process or network access. | `shared`, `bus`, `infra/anthropic` types |
| `infra/` | Side effects: SQLite, git, processes, the Anthropic client. | `shared` |
| `http/` | REST routes and the SSE hub. Thin: no rules. | all of the above |
| `bus.ts` | Typed in-process domain events. | `shared` |
| `index.ts` | Composition root. Builds and wires; no logic. | everything |

`Monitor` is the single entry point that changes session state. Ingest calls `ingestLines`, `applyHook` and `applyProcesses`, and a 5 s `tick`. After each change `Monitor` recomputes status and activity and emits domain events. Nothing else emits session events.

```gherkin
@sc-activity-bus-events
Scenario: activity changes are emitted on the bus
  Given a Monitor wired to a Bus
  When hooks move a session through tool start, tool end and stop
  Then the bus receives one activity_changed event per change of the shown activity
  And nothing outside Monitor emits session events
```

## Format modules
Exactly one file changes when an external format changes (principle 4).

| Format | Module |
|---|---|
| Transcript JSONL | `server/src/ingest/transcript.ts` |
| Hook payloads | `server/src/ingest/hooks.ts` |
| Statusline payload | `server/src/ingest/statusline.ts` |
| Anthropic quota endpoints | `server/src/infra/anthropic.ts` |
| Live session registry (`sessions/<pid>.json`) | `server/src/infra/procs.ts` |
