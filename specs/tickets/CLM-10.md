---
id: CLM-10                       # assigned by `flow new`, never by hand
title: "Glass Dark: Processes and Quota pages"
type: change                   # feature | change | bug | refactor | chore
status: done               # draft | approved | in_progress | validating | done | blocked | cancelled
priority: medium           # low | medium | high | critical

# Placement
epic: CLM-6                   # KEY-n of an epic, or null
subproject: [web]       # one or several, e.g. [frontend, backend]; [] if single project
module: [processes-page, quota-page]
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
  spec: [user-interface.md#processes-page, user-interface.md#quota-page]
  scenarios: []
  code_scope: [web/src/pages/Processes.tsx, web/src/pages/Quota.tsx, web/src/components/QuotaHistoryChart.tsx, web/src/styles/**, specs/general/user-interface.md]

# Closure gate: set after implementation (required before done)
claude_md: unchanged               # pending | updated | unchanged
---

# CLM-10 · Glass Dark: Processes and Quota pages

## Why
The Processes table gives bare numbers, and the Quota page makes the user read percentages and sentences to know how close a limit is. The author wants both readable at a glance, per the Glass Dark design proposal.

## Current behavior
See `user-interface.md#processes-page` (live processes and their session) and `#quota-page` (window cards with pace, per-model weeks, 7-day history with table view, who used the 5-hour window, alerts). All of that behavior stays.

## Requested change
**Processes**
- Tiles: processes (and how many are linked), total CPU, total memory, unlinked processes.
- The table is sorted by CPU by default and sortable by CPU and memory.
- CPU shows the value and a sparkline of the samples received since the page opened (page state, at most 60 per process); memory a bar relative to the largest.
- The project cell shows the folder name and the full cwd in mono; a process with no session is tagged "Unlinked", with a note explaining it.

**Quota**
- Each window as a radial gauge of percentage left, with the level as word, icon and color, the used %, the reset and the pace sentence (still labelled an estimate).
- Weekly by model: meters with marks at the configured alert thresholds.
- History chart: shaded bands for getting low and almost out, reset markers, a "now" marker and a dashed projection from now to the reset at the existing pace. The table view stays.
- "Who used the current 5-hour window" as a ranking of horizontal share bars, each row linking to its session, with tokens and cost under the title.
- Alerts: the notification permission shown as a status chip, the thresholds as chips; the enable button stays.

### Checklist
- [x] C1 — Processes tiles, CPU sort, CPU sparkline, memory bar and Unlinked tag · · verify: manual · impl: yes · spec: yes
- [x] C2 — Quota window gauges with level, reset and pace · · verify: manual · impl: yes · spec: yes
- [x] C3 — Per-model meters with threshold marks · · verify: manual · impl: yes · spec: yes
- [x] C4 — History chart bands, reset and now markers and projection; table view still available · · verify: manual · impl: yes · spec: yes
- [x] C5 — Share ranking linking to sessions, and the alerts permission chip · · verify: manual · impl: yes · spec: yes
- [x] C6 — The build passes · · verify: command(npm run build) · impl: yes · spec: yes

## Scenarios (after state)
None: the web package has no automated tests and no Gherkin scenario in `user-interface.md` changes; the author checks every item in the browser.

## Agent instructions impact
None expected. Uses the tokens, icons and components from CLM-5; adds none of its own.

## Out of scope
- A CPU history kept by the server, or kept across page loads.
- A history of fired alerts.
- Anything that needs new server data: deltas against the previous period, the "saved vs no cache" estimate, the Pipeline time split, alert history.
- Any change to which data is shown, how it is computed, or the routes.

## Open questions

## Change log
Append-only. One row per change to the ticket, always with a reason. Written by `flow`, never by hand.

| Date | Action | Change | Reason |
|---|---|---|---|
| 2026-11-14 | created | status: null → draft | Split from CLM-5: the Processes and Quota part of the Glass Dark redesign |
| 2026-11-14 | refined | definition | Wrote the definition from the Glass Dark design proposal, split out of CLM-5 |
| 2026-11-14 | contradiction-check | check | clean: processes-page and quota-page only; pace, attribution and alert rules unchanged, only their display; no sibling touches these sections |
| 2026-11-14 | status | status: draft → approved | The author approved the Glass Dark epic and all its tickets in chat |
| 2026-11-16 | status | status: approved → in_progress | Implementation committed earlier; CLM-5 is now done |
| 2026-11-16 | item | C1.impl: no → yes | The author checked the Glass Dark design in the browser and approved it in chat on 2026-11-16 |
| 2026-11-16 | item | C1.spec: no → yes | user-interface.md#processes-page, #quota-page |
| 2026-11-16 | item | C2.impl: no → yes | The author checked the Glass Dark design in the browser and approved it in chat on 2026-11-16 |
| 2026-11-16 | item | C2.spec: no → yes | user-interface.md#processes-page, #quota-page |
| 2026-11-16 | item | C3.impl: no → yes | The author checked the Glass Dark design in the browser and approved it in chat on 2026-11-16 |
| 2026-11-16 | item | C3.spec: no → yes | user-interface.md#processes-page, #quota-page |
| 2026-11-16 | item | C4.impl: no → yes | The author checked the Glass Dark design in the browser and approved it in chat on 2026-11-16 |
| 2026-11-16 | item | C4.spec: no → yes | user-interface.md#processes-page, #quota-page |
| 2026-11-16 | item | C5.impl: no → yes | The author checked the Glass Dark design in the browser and approved it in chat on 2026-11-16 |
| 2026-11-16 | item | C5.spec: no → yes | user-interface.md#processes-page, #quota-page |
| 2026-11-16 | item | C6.impl: no → yes | npm run build passes |
| 2026-11-16 | item | C6.spec: no → yes | user-interface.md#processes-page, #quota-page |
| 2026-11-16 | set | claude_md: pending → unchanged | No new convention: uses the tokens, icons and components from CLM-5 |
| 2026-11-16 | status | status: in_progress → validating | All items implemented and synced into the spec |
| 2026-11-16 | status | status: validating → done | The author checked the Glass Dark design in the browser and approved it in chat on 2026-11-16 |
