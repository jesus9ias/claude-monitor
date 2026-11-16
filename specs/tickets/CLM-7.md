---
id: CLM-7                       # assigned by `flow new`, never by hand
title: "Glass Dark: Sessions page tiles, cost chart and session table"
type: change                   # feature | change | bug | refactor | chore
status: done               # draft | approved | in_progress | validating | done | blocked | cancelled
priority: medium           # low | medium | high | critical

# Placement
epic: CLM-6                   # KEY-n of an epic, or null
subproject: [web]       # one or several, e.g. [frontend, backend]; [] if single project
module: [sessions-page]
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
  spec: [user-interface.md#sessions-page]
  scenarios: []
  code_scope: [web/src/pages/Sessions.tsx, web/src/components/CostByDayChart.tsx, web/src/format.ts, web/src/styles/**, specs/general/user-interface.md]

# Closure gate: set after implementation (required before done)
claude_md: unchanged               # pending | updated | unchanged
---

# CLM-7 · Glass Dark: Sessions page tiles, cost chart and session table

## Why
On the Sessions page the numbers have to be read one cell at a time and the table cannot be searched or sorted. The author wants the tiles, the cost chart and the session table to show the picture at a glance, per the Glass Dark design proposal.

## Current behavior
See `user-interface.md#sessions-page`: range picker, three tiles, cost by day per model with a donut, and the session table with History / By project, filtered by the range. All of that behavior stays.

## Requested change
- Tiles gain an icon and a sparkline from the range's daily rows; a fourth tile shows the cache hit rate (cache read / all input) for the range.
- Cost by day: a Cost / Tokens toggle, a clickable legend that hides a model, the day total above each bar, a dashed average line, the glass tooltip, and a by-model bar list beside the chart in place of the donut.
- Session table:
  - Search over project, title and id; Ctrl K focuses it.
  - Status filter chips (All, Active, Idle, Ended) with counts, and a model filter.
  - Sortable columns with a visible sort direction, default last activity, newest first; sticky header.
  - Tokens show a stacked in / out / cache bar; cost a bar relative to the costliest shown row.
  - A "Doing now" column shows the activity with its tool-category icon.
  - Last activity shows the absolute time on hover; a row action copies the session id.
  - A footer says "Showing n of m".
  - The table scrolls sideways inside its card; below 768 px rows become cards (status, title, project, model, activity, cost bar).
- Search, filters and sort apply to both views and combine with the range filter; in By project, group totals count only the shown sessions, as today. Search, filters and sort are client-side and not remembered across reloads.

### Checklist
- [x] C1 — Tiles with icons, sparklines and the cache hit rate tile · · verify: manual · impl: yes · spec: yes
- [x] C2 — Cost chart with Cost/Tokens toggle, clickable legend, day totals, average line and by-model list · · verify: manual · impl: yes · spec: yes
- [x] C3 — Table search, status and model filters and sorting, combined with the range filter in both views · · verify: manual · impl: yes · spec: yes
- [x] C4 — Token and cost bars, Doing now column, absolute time on hover, copy id and count footer · · verify: manual · impl: yes · spec: yes
- [x] C5 — Cards below 768 px; History / By project and collapsed groups still work and are remembered · · verify: manual · impl: yes · spec: yes
- [x] C6 — The build passes · · verify: command(npm run build) · impl: yes · spec: yes

## Scenarios (after state)
None: the web package has no automated tests and no Gherkin scenario in `user-interface.md` changes; the author checks every item in the browser.

## Agent instructions impact
None expected. Uses the tokens, icons and components from CLM-5; adds none of its own.

## Out of scope
- Tile deltas against the previous period ("+18% vs previous 7 days").
- Remembering search, filters or sort across reloads.
- Anything that needs new server data: deltas against the previous period, the "saved vs no cache" estimate, the Pipeline time split, alert history.
- Any change to which data is shown, how it is computed, or the routes.

## Open questions

## Change log
Append-only. One row per change to the ticket, always with a reason. Written by `flow`, never by hand.

| Date | Action | Change | Reason |
|---|---|---|---|
| 2026-11-14 | created | status: null → draft | Split from CLM-5: the Sessions page part of the Glass Dark redesign |
| 2026-11-14 | refined | definition | Wrote the definition from the Glass Dark design proposal, split out of CLM-5 |
| 2026-11-14 | contradiction-check | check | clean: only user-interface.md#sessions-page; keeps CLM-3 grouping and CLM-4 range filter, search and filters combine with them; no sibling touches this section |
| 2026-11-14 | status | status: draft → approved | The author approved the Glass Dark epic and all its tickets in chat |
| 2026-11-16 | refined | definition | Implementation done ahead of the status move: CLM-5 is validating, waiting on the author's manual check, so CLM-7 cannot enter in_progress yet |
| 2026-11-16 | status | status: approved → draft | Definition changed after approval; needs re-approval |
| 2026-11-16 | contradiction-check | check | Unchanged definition, same outcome as before: only user-interface.md#sessions-page; CLM-3 grouping and CLM-4 range filter kept |
| 2026-11-16 | status | status: draft → approved | Restored: the definition did not change; a progress note was wrongly logged as a refinement. The author approved this definition in chat on 2026-11-14 |
| 2026-11-16 | status | status: approved → in_progress | Implementation committed earlier; CLM-5 is now done |
| 2026-11-16 | item | C1.impl: no → yes | The author checked the Glass Dark design in the browser and approved it in chat on 2026-11-16 |
| 2026-11-16 | item | C1.spec: no → yes | user-interface.md#sessions-page |
| 2026-11-16 | item | C2.impl: no → yes | The author checked the Glass Dark design in the browser and approved it in chat on 2026-11-16 |
| 2026-11-16 | item | C2.spec: no → yes | user-interface.md#sessions-page |
| 2026-11-16 | item | C3.impl: no → yes | The author checked the Glass Dark design in the browser and approved it in chat on 2026-11-16 |
| 2026-11-16 | item | C3.spec: no → yes | user-interface.md#sessions-page |
| 2026-11-16 | item | C4.impl: no → yes | The author checked the Glass Dark design in the browser and approved it in chat on 2026-11-16 |
| 2026-11-16 | item | C4.spec: no → yes | user-interface.md#sessions-page |
| 2026-11-16 | item | C5.impl: no → yes | The author checked the Glass Dark design in the browser and approved it in chat on 2026-11-16 |
| 2026-11-16 | item | C5.spec: no → yes | user-interface.md#sessions-page |
| 2026-11-16 | item | C6.impl: no → yes | npm run build passes |
| 2026-11-16 | item | C6.spec: no → yes | user-interface.md#sessions-page |
| 2026-11-16 | set | claude_md: pending → unchanged | No new convention: uses the tokens, icons and components from CLM-5 |
| 2026-11-16 | status | status: in_progress → validating | All items implemented and synced into the spec |
| 2026-11-16 | status | status: validating → done | The author checked the Glass Dark design in the browser and approved it in chat on 2026-11-16 |
