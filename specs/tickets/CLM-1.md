---
id: CLM-1                       # assigned by `flow new --quick`
title: Adopt the ticket-spec flow
type: chore                   # chore | bug | refactor: a quick ticket never changes behavior defined in the spec
quick: true
status: done               # draft | approved | in_progress | validating | done | blocked | cancelled
priority: medium

epic: null
subproject: [shared, server, web]
module: []
feature: []

assignee: null
requester: null
commitment_date: null   # YYYY-MM-DD; change it with `flow set` (needs a reason)

depends_on: []
supersedes: []                   # not allowed on quick tickets

# STAMPED BY `flow index`, never edit by hand
blocks: []
superseded_by: null
obsolete: false

touches:
  spec: []                       # must stay empty. If a spec section has to change, this is not a quick ticket.
  scenarios: []                  # must stay empty
  code_scope: [specs/**, CLAUDE.md, README.md, .gitignore, server/test/*.test.ts]   # globs the implementation may modify (required)

claude_md: updated               # pending | updated | unchanged
---

# CLM-1 · Adopt the ticket-spec flow

## What
Adopt ticket-spec-flow in the repository: vendor the `flow` CLI under `specs/.flow/`, split the former root `spec.md` into `specs/general/` (one file per area, every tested behavior as a tagged Gherkin scenario), tag the covering tests with `// @sc-<id>` comments, write `CLAUDE.md` with the working rules, and point the README at the new spec.

## Done when
`node specs/.flow/flow.mjs validate` passes, `flow drift` reports 0 scenarios without a test and 0 unknown test tags, and `npm test` is green · verify: command(npm test)

## Change log
Append-only. One row per change to the ticket, always with a reason. Written by `flow`, never by hand.

| Date | Action | Change | Reason |
|---|---|---|---|
| 2026-11-13 | created | status: null → draft | Bring the existing codebase into the flow: general spec split from spec.md, scenario tags on tests, CLAUDE.md, vendored CLI |
| 2026-11-13 | status | status: draft → approved | Author asked to commit the adoption in this conversation |
| 2026-11-13 | status | status: approved → in_progress | Adoption work done in the working tree |
| 2026-11-13 | set | claude_md: pending → updated | CLAUDE.md created with commands, layout, conventions, secrets rules and the FLOW.md import |
| 2026-11-13 | status | status: in_progress → validating | flow validate OK, flow drift 0 untested scenarios, npm test 49/49 green |
| 2026-11-13 | status | status: validating → done | Verified by command(npm test): 49 pass, 0 fail; validate and drift clean |
