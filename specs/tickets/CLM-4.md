---
id: CLM-4                       # assigned by `flow new`, never by hand
title: Session table follows the date range
type: feature                   # feature | change | bug | refactor | chore
status: done               # draft | approved | in_progress | validating | done | blocked | cancelled
priority: medium           # low | medium | high | critical

# Placement
epic: null                   # KEY-n of an epic, or null
subproject: [web]       # one or several, e.g. [frontend, backend]; [] if single project
module: [sessions-page]
feature: [date-range]

# People and date
assignee: null
requester: null
commitment_date: null   # YYYY-MM-DD. The only hand-set date; change it with `flow set` (needs a reason). created/started/finished come from the log.

# Relationships: hand-written side
depends_on: []       # tickets that must be done first
supersedes: []       # tickets whose definition this one replaces

# Relationships: STAMPED BY `flow index`, never edit by hand
blocks: []
superseded_by: null
obsolete: false

# What this ticket may touch (drives reading, contradiction check and loop guards)
touches:
  spec: [user-interface.md#sessions-page]
  scenarios: [sc-sessions-table-follows-range]
  code_scope: [web/src/pages/Sessions.tsx, web/src/format.ts, web/src/styles/**, specs/general/**]

# Closure gate: set after implementation (required before done)
claude_md: unchanged               # pending | updated | unchanged
---

# CLM-4 · Session table follows the date range

## Why
The range picker changes the totals and the cost-by-day chart but not the session table, so the table keeps showing sessions from weeks ago. The author wants the table to show only the sessions that did something in the chosen range.

## Current behavior
See `user-interface.md#sessions-page`: the range picker drives the tiles and the chart (via `/api/stats`); the session table always lists every session from the live store, in both the History and By project views.

## Requested change
- The session table shows only sessions whose last activity (`lastEventAt`) is at or after the start of the selected range. The range start is the same one `/api/stats` uses: local midnight today for Today, local midnight 6 days ago for 7 days, 29 days ago for 30 days.
- Active sessions are always shown, even when their last event is older than the range start.
- The filter applies to both views. In By project, a group with no visible session is hidden, and the group header totals (sessions, active, tokens, cost, last activity) sum only the visible sessions.
- Row values stay as they are: tokens and cost are the whole session's, not the part inside the range.
- With sessions present but none in the range, the table shows "No sessions in this range." instead of an empty table.
- The filter is client-side and updates live: it re-applies when the range changes, when sessions update, and as time passes (a session that drops out of Today at midnight disappears without a reload). No server, REST or stream change; `PROTOCOL_VERSION` is untouched.

### Checklist
- [x] C1 — History view hides sessions with no activity in the range and keeps active ones · verify: manual · impl: yes · spec: yes
- [x] C2 — By project view hides empty groups and sums only visible sessions in headers · verify: manual · impl: yes · spec: yes
- [x] C3 — Empty range shows "No sessions in this range."; changing the range updates the table at once · verify: manual · impl: yes · spec: yes

## Scenarios (after state)
```gherkin
@sc-sessions-table-follows-range @CLM-4
Scenario: the session table follows the date range
  Given an idle session last active 3 days ago, an idle session last active today, and an active session last active 2 days ago
  When the user picks "Today"
  Then the table shows the session active today and the active session, but not the one from 3 days ago
  When the user picks "7 days"
  Then all three sessions are shown, each with its whole-session tokens and cost
  When the user picks "By project" with "Today" selected
  Then a project whose only session is the one from 3 days ago has no group, and group totals count only the shown sessions
```

## Agent instructions impact
None expected.

## Out of scope
- Per-row tokens and cost limited to the range (would need per-session, per-day data from the server).
- The "Active now" tile and its "of N sessions" count stay as they are.
- A custom date range or new range options.

## Open questions

## Change log
Append-only. One row per change to the ticket, always with a reason. Written by `flow`, never by hand.

| Date | Action | Change | Reason |
|---|---|---|---|
| 2026-11-14 | created | status: null → draft | The author noticed the range picker changes totals and the chart but not the session table, and wants sessions with no activity in the range hidden |
| 2026-11-14 | refined | definition | Wrote the definition: hide rows outside the range, keep lifetime totals per row |
| 2026-11-14 | contradiction-check | check | clean: only user-interface.md#sessions-page changes, declared in touches; CLM-3 grouping kept, group totals now over visible sessions; no open tickets overlap |
| 2026-11-14 | status | status: draft → approved | Approved by the author in conversation |
| 2026-11-14 | status | status: approved → in_progress | Implementation started with the author |
| 2026-11-14 | set | claude_md: pending → unchanged | No new command, dependency, convention or folder; client-side filter only |
| 2026-11-14 | status | status: in_progress → validating | Implemented and checked against /api/sessions; waiting for the author's manual check |
| 2026-11-14 | item | C1.impl: no → yes | Checked by the author in the browser on 2026-11-14 |
| 2026-11-14 | item | C1.spec: no → yes | user-interface.md#sessions-page, @sc-sessions-table-follows-range |
| 2026-11-14 | item | C2.impl: no → yes | Checked by the author in the browser on 2026-11-14 |
| 2026-11-14 | item | C2.spec: no → yes | user-interface.md#sessions-page, @sc-sessions-table-follows-range |
| 2026-11-14 | item | C3.impl: no → yes | Checked by the author in the browser on 2026-11-14 |
| 2026-11-14 | item | C3.spec: no → yes | user-interface.md#sessions-page, @sc-sessions-table-follows-range |
| 2026-11-14 | status | status: validating → done | The author confirmed the manual check |
