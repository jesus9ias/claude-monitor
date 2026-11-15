---
id: CLM-6                       # same counter as tickets
title: Glass Dark redesign
type: epic
status: approved               # draft | approved | cancelled (in progress / done are derived from the child tickets)
priority: medium

subproject: [web]       # one or several
assignee: null
requester: null
commitment_date: null   # YYYY-MM-DD; change it with `flow set` (needs a reason)

depends_on: []       # other epics or tickets that must be done first
supersedes: []

# STAMPED BY `flow index`, never edit by hand
blocks: []
superseded_by: null
obsolete: false
---

# CLM-6 · Glass Dark redesign

## Goal
Every view of the monitor uses one dark glass theme, one icon set, and tables and charts that show the numbers at a glance, following the author's Glass Dark design proposal (a private design canvas with the foundations and every view, desktop and phone).

## Done when
- No light theme remains; every page and tab uses the glass tokens and the shared icon set.
- Each view has the table and chart improvements its ticket lists, and the author has checked them in the browser, at 375 px and at desktop width.
- `user-interface.md` and `CLAUDE.md` describe the dark-only theme and the icon rule.

## Scope notes
- Web only: no server, REST, stream or `PROTOCOL_VERSION` change; every ticket uses data the UI already receives.
- The foundations ticket (CLM-5) lands first; every view ticket depends on it and uses its tokens and icons, never its own.
- Items that need new server data (deltas against the previous period, "saved vs no cache", the Pipeline time split, alert history) are out of the epic.
- The web package has no automated tests: items are checked by the author in the browser, plus `npm run build`.

## Tickets
Not written by hand. Membership comes from each ticket's `epic: CLM-6` and the order from their `depends_on`. See the generated entry in `specs/INDEX.md`.

## Change log
Append-only. One row per change, always with a reason. Written by `flow`, never by hand.

| Date | Action | Change | Reason |
|---|---|---|---|
| 2026-11-14 | created | status: null → draft | The author asked to split CLM-5 into an epic with smaller tickets: foundations first, then one ticket per group of views |
| 2026-11-14 | refined | definition | Wrote goal, done-when and the shared scope notes |
| 2026-11-14 | status | status: draft → approved | The author approved the Glass Dark epic and all its tickets in chat |
