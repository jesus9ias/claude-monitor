---
id: CLM-3                       # assigned by `flow new`, never by hand
title: Group the session table by project
type: feature                   # feature | change | bug | refactor | chore
status: approved               # draft | approved | in_progress | validating | done | blocked | cancelled
priority: medium           # low | medium | high | critical

# Placement
epic: null                   # KEY-n of an epic, or null
subproject: [web]       # one or several, e.g. [frontend, backend]; [] if single project
module: [sessions-page]
feature: [group-by-project]

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
  scenarios: [sc-sessions-group-by-project]
  code_scope: [web/src/pages/Sessions.tsx, web/src/components/**, web/src/format.ts, web/src/styles/**, specs/general/**]

# Closure gate: set after implementation (required before done)
claude_md: pending               # pending | updated | unchanged
---

# CLM-3 · Group the session table by project

## Why
With many sessions across several repos, the flat session table makes it hard to see what each project is doing and costing. The author wants to switch between the current chronological list and a view grouped by project.

## Current behavior
See `user-interface.md#sessions-page`: the session table is one flat list from the live store, newest activity first, with the project name (from `cwd`) in a column. There is no grouping.

## Requested change
- A segmented toggle **History / By project** on the Sessions card, styled like the range picker. Default: History.
- **History** is the table as it is today.
- **By project** groups sessions by their full `cwd` path (two folders with the same name in different paths stay apart). Each group has a header row with the project name (full path on hover), session count, active count, summed in + out tokens, summed cache tokens, summed cost (shown as unknown if any session's cost is null) and the latest activity. Sessions in a group keep the History order.
- Groups are ordered by latest activity, newest first, so live projects stay on top.
- A group header can be collapsed and expanded with mouse and keyboard (Enter/Space, `aria-expanded`). Groups start expanded.
- The chosen view and the collapsed groups are remembered per browser in `localStorage`, wrapped so the page works when storage is unavailable.
- Grouping is client-side only: no server, REST or stream change, so `PROTOCOL_VERSION` is untouched.
- Works at 375 px, follows the system theme, and any collapse animation respects reduced motion.

### Checklist
- [ ] C1 — The toggle switches between History (unchanged table) and By project · verify: manual · impl: no · spec: no
- [ ] C2 — By project groups by full cwd, with header totals (sessions, active, tokens, cache, cost, last activity) and groups ordered by latest activity · verify: manual · impl: no · spec: no
- [ ] C3 — Groups collapse and expand by mouse and keyboard; view and collapsed groups survive a reload · verify: manual · impl: no · spec: no
- [ ] C4 — Live updates move sessions and groups without losing the chosen view or collapsed state · verify: manual · impl: no · spec: no
- [ ] C5 — Layout works at 375 px in light and dark themes · verify: manual · impl: no · spec: no
- [ ] C6 — `npm run build` passes · verify: command(npm run build) · impl: no · spec: no

## Scenarios (after state)
```gherkin
@sc-sessions-group-by-project @CLM-3
Scenario: the session table can be grouped by project
  Given live sessions in two folders, /a/app and /b/app, and the newest activity in /b/app
  When the user picks "By project"
  Then there are two groups, /b/app first, both labelled "app" with the full path on hover
  And each group header shows its session count, active count, summed tokens and cost, and latest activity
  When the user collapses /a/app and reloads the page
  Then "By project" is still selected and /a/app is still collapsed
  When the user picks "History"
  Then the table is the flat list, newest activity first
```

## Agent instructions impact
None expected: a UI-only change in an existing page.

## Out of scope
- Merging sessions of one repo opened from subfolders or worktrees (would need the git root from the server).
- Grouping the cost-by-day chart or the tiles by project.
- Filtering or searching sessions.

## Open questions

## Change log
Append-only. One row per change to the ticket, always with a reason. Written by `flow`, never by hand.

| Date | Action | Change | Reason |
|---|---|---|---|
| 2026-11-13 | created | status: null → draft | Author asked for a History / By project toggle on the Sessions page |
| 2026-11-13 | refined | definition | Filled definition: History / By project toggle, groups by full cwd with totals, collapsible, remembered per browser |
| 2026-11-13 | contradiction-check | check | clean: only extends user-interface.md#sessions-page and adds sc-sessions-group-by-project; no open tickets overlap |
| 2026-11-13 | status | status: draft → approved | Approved by the author in chat |
