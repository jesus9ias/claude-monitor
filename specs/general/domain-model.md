# Domain model

The exact shapes live in `shared/src`; this section says what those types mean.

## Entities
Session, Event, Activity, Phase, tool category, Quota and Cost are the domain's vocabulary.

- **Session**: id, cwd, git branch, model, `entrypoint`, `status`, `activity`, usage totals and per model, estimated cost, subagent ids, linked pid. A session with no cwd yet is hidden from the list but can still be reached by URL.
- **Event**: one thing in a session's history. Kinds: `user`, `assistant`, `thinking`, `tool_use`, `tool_result`, `subagent_start`, `subagent_stop`, `hook`. Each event has a short `summary`; tool events also carry a truncated `detail`. Subagent events have `agentId` and `isSidechain`.
- **Activity**: `{ phase, since, tool?, agents[], source }`.
- **Phase**: `waiting_input`, `requesting`, `thinking`, `writing`, `tool`, `waiting_permission`, `compacting` or `ended`.
- **Tool category** (`shared/src/tools.ts`): `read`, `search`, `edit`, `shell`, `mcp` (parsed from `mcp__<server>__<tool>`), `skill`, `agent`, `web`, `planning` or `other`. The server and the UI use this one classifier.
- **Quota**: `{ status: not_configured | ok | error, source, fetchedAt, fiveHour, sevenDay, sevenDayByModel }`. Each window is `{ usedPct, resetsAt }`. On an error the last good windows are kept.

## Cost
Cost is what the usage would cost on the API, computed per API message from `server/src/domain/pricing.json` (USD per 1M tokens); it is not what a subscription charges.

It separates 5-minute and 1-hour cache writes, and applies long-prompt tiers and the fast-mode multiplier. A model with no price makes the session's cost `null` (shown as "n/a").

```gherkin
@sc-cost-unknown-model-null
Scenario: an unknown model makes the session cost null
  Given an assistant message from a model that has no entry in the price table
  When it is ingested
  Then the session's cost is null

@sc-cost-cache-tiers-fast-mode
Scenario: cost separates cache write kinds and applies tiers and fast mode
  Given a price table with 5-minute and 1-hour cache write prices, a long-prompt tier and a fast multiplier
  When a message's cost is computed
  Then 5-minute and 1-hour cache writes are priced separately
  And a message over the tier's token threshold uses the tier prices
  And a fast-mode message is multiplied by the fast multiplier
```
