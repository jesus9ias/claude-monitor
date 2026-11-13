---
id: CLM-2                       # assigned by `flow new`, never by hand
title: Context window comes from the model, not only from observed usage
type: bug                   # feature | change | bug | refactor | chore
status: done               # draft | approved | in_progress | validating | done | blocked | cancelled
priority: medium           # low | medium | high | critical

# Placement
epic: null                   # KEY-n of an epic, or null
subproject: [server]       # one or several, e.g. [frontend, backend]; [] if single project
module: [pipeline]
feature: [context-window]

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
  spec: [user-interface.md#pipeline-tab, interfaces.md#pipeline-stats]  # general-spec sections, relative to the general spec folder, e.g. auth.md#login
  scenarios: [sc-pipeline-context-window]  # stable scenario IDs (sc-...) changed or added by this ticket
  code_scope: [server/src/domain/models.json, server/src/domain/pipeline.ts, server/test/pipeline.test.ts, specs/general/**]  # globs the implementation may modify

# Closure gate: set after implementation (required before done)
claude_md: unchanged               # pending | updated | unchanged
---

# CLM-2 · Context window comes from the model, not only from observed usage

## Why
The Pipeline tab's Context block shows a 200K window for Opus 5.5 sessions, whose real window is 1M. It only jumps to 1M once a session passes 200K, so the fill bar is wrong (about 5x too full) for most of the session.

## Current behavior
See `user-interface.md#pipeline-tab` and `interfaces.md#pipeline-stats` (`@sc-pipeline-context-window`): the window is looked up in `server/src/domain/models.json`, falling back to `default` (200K) and switching to `extended` (1M) when the observed context exceeds it. The `models` map is empty, so every model falls back to 200K.

## Requested change
- `models.json` lists the window of each current model: `claude-opus-5-5`, `claude-fable-5-2`, `claude-sonnet-5-5` and `claude-haiku-5-5` at 1,000,000 tokens. Ids match `pricing.json`; a dated suffix is still stripped.
- A model not in the map keeps the 200K default, and the "seen above its window → 1M variant" fallback stays.

### Checklist
- [x] C1 — A listed model (for example `claude-opus-5-5`, also with a dated suffix) gets its window from models.json before any usage is seen · verify: test · impl: yes · spec: yes
- [x] C2 — An unlisted model keeps the 200K default and still moves to 1M once seen above it · verify: test · impl: yes · spec: yes
- [x] C3 — The Pipeline tab shows a 1M window for a live Opus 5.5 session under 200K · verify: manual · impl: yes · spec: yes

## Scenarios (after state)
```gherkin
@sc-pipeline-context-window @CLM-2
Scenario: context is the latest main message's prompt size and the window comes from the model
  Given assistant messages on the main transcript and one compaction
  When the pipeline stats are built
  Then the context size is the latest main message's input plus cache-read tokens
  And the compactions counter is 1
  And a model listed in models.json, with or without a dated suffix, has its listed window (claude-opus-5-5: 1M)
  And a model not listed has the default window (200K)
  Given a session seen with more tokens than its window
  Then the context window is the 1M-token variant
```

## Agent instructions impact
None expected: models.json is already named in `CLAUDE.md` as the place for model data.

## Out of scope
- Reading the window from the statusline payload or from Claude Code settings (for example a `[1m]` model suffix).
- Older models (Fable 5.1, Fable 5, Haiku 4.5…): they keep the default plus fallback unless added later.
- Any change to the UI component; it already draws `windowTokens`.

## Open questions

## Change log
Append-only. One row per change to the ticket, always with a reason. Written by `flow`, never by hand.

| Date | Action | Change | Reason |
|---|---|---|---|
| 2026-11-13 | created | status: null → draft | Opus 5.5 sessions show a 200K context window until they pass 200K; models.json lists no model windows |
| 2026-11-13 | refined | definition | Filled definition: per-model windows in models.json, fallback kept |
| 2026-11-13 | contradiction-check | check | clean: changes sc-pipeline-context-window declared in touches; no open tickets overlap |
| 2026-11-13 | status | status: draft → approved | Approved by the author in chat |
| 2026-11-13 | status | status: approved → in_progress | Implementation started |
| 2026-11-13 | item | C1.impl: no → yes | contextWindow assertions for claude-opus-5-5 and dated suffix in pipeline.test.ts |
| 2026-11-13 | item | C1.spec: no → yes | interfaces.md scenario and user-interface.md Pipeline tab updated |
| 2026-11-13 | item | C2.impl: no → yes | contextWindow('m',150k)=200k and ('m',300k)=1M asserted |
| 2026-11-13 | item | C2.spec: no → yes | Scenario keeps default and fallback lines |
| 2026-11-13 | set | claude_md: pending → unchanged | models.json is already documented as model data in CLAUDE.md |
| 2026-11-13 | status | status: in_progress → validating | Code, tests and spec done; C3 awaits the author |
| 2026-11-13 | item | C3.impl: no → yes | Author confirmed in chat that the Pipeline shows 1M for a live Opus 5.5 session |
| 2026-11-13 | item | C3.spec: no → yes | user-interface.md Pipeline tab already synced |
| 2026-11-13 | status | status: validating → done | All items verified; C3 confirmed by the author |
