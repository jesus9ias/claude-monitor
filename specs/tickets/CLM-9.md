---
id: CLM-9                       # assigned by `flow new`, never by hand
title: "Glass Dark: Flow and Pipeline tabs"
type: change                   # feature | change | bug | refactor | chore
status: approved               # draft | approved | in_progress | validating | done | blocked | cancelled
priority: medium           # low | medium | high | critical

# Placement
epic: CLM-6                   # KEY-n of an epic, or null
subproject: [web]       # one or several, e.g. [frontend, backend]; [] if single project
module: [session-view]
feature: [flow-graph, pipeline]

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
  spec: [user-interface.md#flow-tab, user-interface.md#pipeline-tab]
  scenarios: []
  code_scope: [web/src/pages/session/FlowTab.tsx, web/src/pages/session/PipelineTab.tsx, web/src/pages/session/pipeline/**, web/src/styles/**, specs/general/user-interface.md]

# Closure gate: set after implementation (required before done)
claude_md: pending               # pending | updated | unchanged
---

# CLM-9 · Glass Dark: Flow and Pipeline tabs

## Why
The Flow and Pipeline diagrams show a lot of state with text only, and replay has a single button. The author wants status and categories readable at a glance and replay under the user's control, per the Glass Dark design proposal.

## Current behavior
See `user-interface.md#flow-tab` (dagre graph, folded groups, node drawer, running nodes pulse) and `#pipeline-tab` (fixed SVG loop, lit blocks and particles, block drawer, replay of the last turn at 4x). All of that behavior stays.

## Requested change
**Flow**
- Glass nodes with the category icon, label, status and meta; the border shows status (running glows teal, error rose, selected iris).
- A fixed legend (running, ok, error, subagent) and grouped controls: zoom out / in with the level, fit, expand all.
- The minimap colors nodes by status.
- The node drawer becomes a side inspector beside the graph: kind, status, summary, duration, tokens, model, cost, tool calls per category as bars, failed calls, and a link to the event in Events.

**Pipeline**
- Blocks carry their icon (category icons for the tool blocks); the active path takes its block color and categories with no calls in the session dim.
- Replay becomes a transport bar: previous / play-pause / next step, speed 1×, 2×, 4× (default 4×, the step hold of 350 ms to 2 s scales with it), and a timeline with one tick per step colored by phase that can be clicked to jump. "Back to live" ends the replay, and an active session still ends it.
- Beside the diagram, the last turn's calls per category as horizontal bars with icons, from the existing pipeline stats.
- Reduced motion: still no particles or pulses; the active path is shown by color alone.

### Checklist
- [ ] C1 — Flow nodes with icons and status borders, legend, grouped controls and status minimap · · verify: manual · impl: no · spec: no
- [ ] C2 — Flow side inspector replaces the drawer, with the link to Events · · verify: manual · impl: no · spec: no
- [ ] C3 — Pipeline block icons, colored active path and dimmed unused categories · · verify: manual · impl: no · spec: no
- [ ] C4 — Replay transport bar with step, pause, speed and clickable timeline · · verify: manual · impl: no · spec: no
- [ ] C5 — Last-turn calls per category as bars beside the diagram · · verify: manual · impl: no · spec: no
- [ ] C6 — The build passes · · verify: command(npm run build) · impl: no · spec: no

## Scenarios (after state)
None: the web package has no automated tests and no Gherkin scenario in `user-interface.md` changes; the author checks every item in the browser.

## Agent instructions impact
None expected. Uses the tokens, icons and components from CLM-5; adds none of its own.

## Out of scope
- The "where the time went" split (model, tools, waiting on you).
- Changes to the Flow graph layout or to how the graph and the pipeline stats are built.
- Anything that needs new server data: deltas against the previous period, the "saved vs no cache" estimate, the Pipeline time split, alert history.
- Any change to which data is shown, how it is computed, or the routes.

## Open questions

## Change log
Append-only. One row per change to the ticket, always with a reason. Written by `flow`, never by hand.

| Date | Action | Change | Reason |
|---|---|---|---|
| 2026-11-14 | created | status: null → draft | Split from CLM-5: the Flow and Pipeline part of the Glass Dark redesign |
| 2026-11-14 | refined | definition | Wrote the definition from the Glass Dark design proposal, split out of CLM-5 |
| 2026-11-14 | contradiction-check | check | clean: flow-tab and pipeline-tab only; replay keeps 4x default, the 350 ms to 2 s hold and the end-on-active rule; reduced motion kept; no sibling touches these sections |
| 2026-11-14 | status | status: draft → approved | The author approved the Glass Dark epic and all its tickets in chat |
