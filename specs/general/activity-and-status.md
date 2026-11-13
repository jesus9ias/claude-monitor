# Activity and status

Hooks and transcript lines become signals; signals move a session's phase; the phase and recent history give its status.

## Signals
Transcript lines and hooks both map to the same set of signals (the hook mapping is in `data-sources.md#hooks`).

| Transcript | Signal |
|---|---|
| user prompt | prompt |
| `api-request` | request |
| thinking block | thinking |
| text block | writing |
| `tool_use` block | tool_start |
| `tool_result` | tool_end |
| `stop_hook_summary` | stop |
| `compact_boundary` | compact_end |
| subagent transcript appears | agent_start |

## Phases
Each signal moves the phase as in the table below; the rules after it decide which signals win.

| Signal | Phase |
|---|---|
| prompt, request, tool_end, compact_end | `requesting` |
| thinking | `thinking` |
| writing | `writing` |
| tool_start | `tool` (with the classified tool) |
| permission | `waiting_permission` |
| start, waiting_input, stop | `waiting_input` |
| compact_start | `compacting` |
| end | `ended` |

Rules:

1. **Order.** A signal older than the current phase's `since` never changes the phase. Hooks arrive within milliseconds, but a transcript line is written only when its block is complete. This rule keeps a late text line from undoing a `Stop`.
2. **Parallel tools.** The end of one tool call does not end another call that is still running.
3. **Overtaking.** A `PostToolUse` can arrive before its `PreToolUse`. A tool already finished is never shown as running.
4. **Subagents** are tracked in `agents[]`. The main loop's phase stays `tool` (category `agent`) while the Agent call runs.
5. **Expiry.** A tool with no end after 15 minutes is dropped.
6. **View.** The shown activity depends on the session's status. A working phase in an `idle` session is shown as `waiting_input`, and an `ended` session as `ended`.

The transcript only marks the boundaries between blocks. Token-by-token progress is never observed, so any animation inside a phase is simulated by the UI.

```gherkin
@sc-activity-tool-active
Scenario: a running tool makes the session active and shows in the activity
  Given a session that received PreToolUse for an MCP tool, with no end for over 30 s
  Then its status is active and its phase is tool, with category mcp and the server name
  When PostToolUse arrives for the same call
  Then the tool is cleared and the phase is requesting

@sc-activity-stop-idle
Scenario: Stop makes the session idle and waiting, and a new prompt reactivates it
  Given a session that received Stop
  Then its status is idle and its phase waiting_input at once
  When UserPromptSubmit arrives
  Then its status is active again

@sc-activity-session-end
Scenario: SessionEnd ends the session
  Given a session that received SessionEnd
  When no later activity arrives
  Then its status is ended and its phase ended

@sc-activity-permission-prompt
Scenario: a permission prompt is shown as needing input
  Given a session that received PermissionRequest or a permission_prompt Notification
  Then its phase is waiting_permission and its status idle

@sc-activity-compaction
Scenario: compaction is its own phase
  Given a session that received PreCompact
  Then its phase is compacting
  When PostCompact arrives
  Then its phase is requesting

@sc-activity-post-overtakes-pre
Scenario: a Post that overtakes its Pre does not leave a stuck tool
  Given PostToolUse for a call arrives before its PreToolUse
  When the PreToolUse arrives
  Then the tool is not shown as running

@sc-activity-subagent-tools
Scenario: a subagent's tools mark the agent running, not the session's tool
  Given a PreToolUse hook carrying an agent_id
  Then the session's phase and current tool are unchanged
  And that agent appears in agents[] as running

@sc-activity-tool-expiry
Scenario: a tool whose Post was lost expires
  Given a tool started 15 minutes ago with no end
  When the monitor ticks
  Then the tool is dropped from the activity

@sc-activity-late-line-order
Scenario: a late transcript line does not undo a Stop
  Given a session whose phase is waiting_input since a Stop hook
  When a transcript text line with an older timestamp is ingested
  Then the phase stays waiting_input
```

## Status
Status is derived from the activity by ordered rules; the first that matches wins.

1. A running tool → `active`.
2. `waiting_permission` → `idle`.
3. `SessionEnd`, with no later activity (2 s grace) → `ended`.
4. No live process and no activity for 15 minutes → `ended`.
5. `Stop`, with no later activity (2 s grace) → `idle`.
6. Activity in the last 30 s → `active`.
7. Otherwise → `idle`.
