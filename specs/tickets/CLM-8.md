---
id: CLM-8                       # assigned by `flow new`, never by hand
title: "Glass Dark: session header, Overview and Events tabs"
type: change                   # feature | change | bug | refactor | chore
status: done               # draft | approved | in_progress | validating | done | blocked | cancelled
priority: medium           # low | medium | high | critical

# Placement
epic: CLM-6                   # KEY-n of an epic, or null
subproject: [web]       # one or several, e.g. [frontend, backend]; [] if single project
module: [session-view]
feature: [tables, charts]

# People and date
assignee: null
requester: null
commitment_date: null   # YYYY-MM-DD. The only hand-set date; change it with `flow set` (needs a reason). created/started/finished come from the log.

# Relationships: hand-written side
depends_on: [CLM-5]       # tickets that must be done first
supersedes: []       # tickets whose definition this one replaces

# Relationships: STAMPED BY `flow index`, never edit by hand
blocks: []
superseded_by: null
obsolete: false

# What this ticket may touch (drives reading, contradiction check and loop guards)
touches:
  spec: [user-interface.md#session-view, user-interface.md#overview-tab, user-interface.md#events-tab]
  scenarios: []
  code_scope: [web/src/pages/session/SessionLayout.tsx, web/src/pages/session/OverviewTab.tsx, web/src/pages/session/EventsTab.tsx, web/src/components/TokenCharts.tsx, web/src/components/GitPanel.tsx, web/src/styles/**, specs/general/user-interface.md]

# Closure gate: set after implementation (required before done)
claude_md: unchanged               # pending | updated | unchanged
---

# CLM-8 · Glass Dark: session header, Overview and Events tabs

## Why
The session header is one long line of text, the Overview splits tokens over several small charts, and the Events list is hard to scan. The author wants them clearer, per the Glass Dark design proposal.

## Current behavior
See `user-interface.md#session-view` (header and tabs), `#overview-tab` (tiles, tokens over time, git, usage by model) and `#events-tab` (paged list newest first, hooks hidden unless shown, rows expand to the truncated detail). All of that behavior stays.

## Requested change
**Header and tabs**
- A breadcrumb back to Sessions; chips with icons for cwd (with a copy button), branch, model, entrypoint, pid and start time; status and live activity on the right.
- Tabs with icons and counts: Events (total events), Flow (subagents).

**Overview**
- Tiles with icons and a one-line context each (cost per hour, share of output, hit rate).
- One area chart of input, output and cache read with series toggles and a hover cursor, in place of the small charts.
- A cache efficiency ring (cache read / all input) with the read, write and fresh input figures.
- Git: branch with ahead / behind and uncommitted chips; files grouped by change type with a type badge; the existing groups are kept.
- Usage by model with a share-of-cost bar per row and a subagent tag.

**Events**
- A vertical timeline: time, an icon per kind (assistant, tool by category, result, error, hook), tool name, summary, tokens or duration.
- A separator per user turn with its time and counts.
- Filter chips by kind with counts (All, Assistant, Tools, Hooks, Errors), replacing the show-hooks toggle; hooks stay hidden by default. Search over tool name and summary, client-side over the loaded events.
- Errors highlighted; subagent events indented and tagged with the agent.
- Detail expands inline with a Copy button and the "truncated" note.
- "Following live" while the newest event is in view; otherwise a "Jump to latest · n new" button. "Load older events" stays.

### Checklist
- [x] C1 — Header chips with copy path, breadcrumb, and tabs with icons and counts · · verify: manual · impl: yes · spec: yes
- [x] C2 — Overview tiles, single area chart with toggles and the cache ring · · verify: manual · impl: yes · spec: yes
- [x] C3 — Git panel grouped with badges, and usage by model with share bars · · verify: manual · impl: yes · spec: yes
- [x] C4 — Events timeline with kind icons, turn separators, kind filters with counts and search · · verify: manual · impl: yes · spec: yes
- [x] C5 — Inline detail with Copy, error and subagent styling, following live and jump to latest · · verify: manual · impl: yes · spec: yes
- [x] C6 — The build passes · · verify: command(npm run build) · impl: yes · spec: yes

## Scenarios (after state)
None: the web package has no automated tests and no Gherkin scenario in `user-interface.md` changes; the author checks every item in the browser.

## Agent instructions impact
None expected. Uses the tokens, icons and components from CLM-5; adds none of its own.

## Out of scope
- The "saved vs no cache" dollar estimate.
- Exporting events to a file; searching events that are not loaded yet.
- Anything that needs new server data: deltas against the previous period, the "saved vs no cache" estimate, the Pipeline time split, alert history.
- Any change to which data is shown, how it is computed, or the routes.

## Open questions

## Change log
Append-only. One row per change to the ticket, always with a reason. Written by `flow`, never by hand.

| Date | Action | Change | Reason |
|---|---|---|---|
| 2026-11-14 | created | status: null → draft | Split from CLM-5: the session header, Overview and Events part of the Glass Dark redesign |
| 2026-11-14 | refined | definition | Wrote the definition from the Glass Dark design proposal, split out of CLM-5 |
| 2026-11-14 | contradiction-check | check | clean: session-view, overview-tab and events-tab only; the kind filter replaces the show-hooks toggle with hooks still hidden by default; no sibling touches these sections |
| 2026-11-14 | status | status: draft → approved | The author approved the Glass Dark epic and all its tickets in chat |
| 2026-11-16 | status | status: approved → in_progress | Implementation committed earlier; CLM-5 is now done |
| 2026-11-16 | item | C1.impl: no → yes | The author checked the Glass Dark design in the browser and approved it in chat on 2026-11-16 |
| 2026-11-16 | item | C1.spec: no → yes | user-interface.md#session-view, #overview-tab, #events-tab |
| 2026-11-16 | item | C2.impl: no → yes | The author checked the Glass Dark design in the browser and approved it in chat on 2026-11-16 |
| 2026-11-16 | item | C2.spec: no → yes | user-interface.md#session-view, #overview-tab, #events-tab |
| 2026-11-16 | item | C3.impl: no → yes | The author checked the Glass Dark design in the browser and approved it in chat on 2026-11-16 |
| 2026-11-16 | item | C3.spec: no → yes | user-interface.md#session-view, #overview-tab, #events-tab |
| 2026-11-16 | item | C4.impl: no → yes | The author checked the Glass Dark design in the browser and approved it in chat on 2026-11-16 |
| 2026-11-16 | item | C4.spec: no → yes | user-interface.md#session-view, #overview-tab, #events-tab |
| 2026-11-16 | item | C5.impl: no → yes | The author checked the Glass Dark design in the browser and approved it in chat on 2026-11-16 |
| 2026-11-16 | item | C5.spec: no → yes | user-interface.md#session-view, #overview-tab, #events-tab |
| 2026-11-16 | item | C6.impl: no → yes | npm run build passes |
| 2026-11-16 | item | C6.spec: no → yes | user-interface.md#session-view, #overview-tab, #events-tab |
| 2026-11-16 | set | claude_md: pending → unchanged | No new convention: uses the tokens, icons and components from CLM-5 |
| 2026-11-16 | status | status: in_progress → validating | All items implemented and synced into the spec |
| 2026-11-16 | status | status: validating → done | The author checked the Glass Dark design in the browser and approved it in chat on 2026-11-16 |
