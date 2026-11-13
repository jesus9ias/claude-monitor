# Data sources

Four inputs feed the monitor: transcript files on disk, hook payloads, the live session registry, and quota readings from Anthropic or the statusline.

## Transcripts
Claude Code's JSONL transcripts under the config dir are read incrementally and are the source of truth for sessions, events and tokens.

The layout, with `<config>` being `CLAUDE_CONFIG_DIR` or `~/.claude`:

```
<config>/projects/<encoded-cwd>/<sessionId>.jsonl
<config>/projects/<encoded-cwd>/<sessionId>/subagents/agent-<agentId>.jsonl   (+ .meta.json)
```

| Line | Used for |
|---|---|
| `user` | Prompts (`isMeta` lines skipped), `tool_result` blocks, subagent links (`toolUseResult.agentId`). Also `cwd`, `gitBranch` and `entrypoint`. |
| `assistant` | `text` / `thinking` / `tool_use` blocks, `message.model`, `message.usage`. One API message spans several lines that repeat the same `message.id` and usage, so it is counted once, with the latest usage. `<synthetic>` messages count no tokens. |
| `api-request` | Marker: a request to the model went out. |
| `system` / `compact_boundary` | Marker: compaction finished (`compactMetadata.durationMs`). |
| `system` / `stop_hook_summary` | Marker: the turn ended. |
| `system` / `api_error` | Marker, recorded only. |
| `custom-title`, `ai-title` | Session title. A custom title wins over an AI one. |
| `cost-state` | Claude Code's own cost total. Used only by `npm run scan -- --check`. |
| Anything else | Ignored. |

Malformed lines are skipped and counted, and never crash the server. A 10 s sweep catches any changes the file watcher misses.

```gherkin
@sc-transcript-malformed-line-skipped
Scenario: a malformed transcript line is skipped
  Given a line that is not JSON, is empty, is a bare value, or lacks the fields its type needs
  When the parser reads it
  Then it returns no parsed line and does not throw

@sc-transcript-usage-counted-once
Scenario: usage repeated across a message's lines is counted once
  Given several assistant lines sharing one message.id, each carrying the message usage
  When they are ingested
  Then the session counts that usage once, with the latest value seen

@sc-transcript-reingest-noop
Scenario: re-ingesting a line changes nothing
  Given a line already ingested for a session
  When the same line is ingested again
  Then the session's events and usage are unchanged

@sc-transcript-synthetic-no-usage
Scenario: synthetic messages count no usage
  Given an assistant line whose model is <synthetic>
  When it is ingested
  Then the session's usage does not change

@sc-transcript-path-resolves
Scenario: a transcript path identifies its session and agent
  Given a main transcript path and a subagent transcript path under it
  When they are described
  Then the main one yields the session id and no agent
  And the subagent one yields the same session id and its agent id
  And a file that is not .jsonl yields nothing

@sc-scanner-incremental-read
Scenario: the scanner reads incrementally and holds back partial lines
  Given a transcript the scanner has already read
  When new bytes are appended, ending in a line with no newline yet
  Then the scanner reads only the new bytes
  And the unfinished line waits for the next read
  And garbage lines in between are skipped without stopping the scan

@sc-transcript-thinking-event
Scenario: thinking blocks are their own event kind
  Given an assistant line with a thinking block
  When it is parsed
  Then an event of kind thinking is produced
  And the thinking text itself is not in the parsed output

@sc-transcript-phase-markers
Scenario: phase markers are recognised
  Given api-request, compact_boundary (with compactMetadata.durationMs) and stop_hook_summary lines
  When they are parsed
  Then they produce the markers request, compacted (with the duration) and turn_end
  And a system line with an unknown subtype yields nothing

@sc-transcript-entrypoint
Scenario: the entrypoint comes from the transcript line
  Given a main transcript line carrying an entrypoint field
  When it is ingested
  Then the session's entrypoint is that value
```

## Hooks
Every Claude Code hook event is posted to `POST /event` by the installed hooks and becomes an activity signal.

| Hook | Signal |
|---|---|
| `SessionStart` | start |
| `UserPromptSubmit` | prompt |
| `PreToolUse` | tool_start |
| `PostToolUse`, `PostToolUseFailure`, `PermissionDenied` | tool_end |
| `PermissionRequest`, `Elicitation` | permission |
| `Notification` | by `notification_type`: `permission_prompt` or `elicitation_dialog` → permission; `idle_prompt` → waiting_input |
| `PreCompact` / `PostCompact` | compact_start / compact_end |
| `SubagentStart` / `SubagentStop` | agent_start / agent_stop |
| `Stop`, `StopFailure` | stop |
| `SessionEnd` | end |

A hook with an `agent_id` comes from a subagent. It only marks that agent as running, and never changes the session's phase or current tool.

```gherkin
@sc-hook-invalid-body-ignored
Scenario: invalid hook bodies are ignored and unknown events kept
  Given a body that is not an object or has no hook_event_name
  When it is parsed
  Then it yields nothing
  Given a body with an unknown hook_event_name
  When it is parsed
  Then it yields one hook event and no signal

@sc-hook-content-never-stored
Scenario: hook payload content never reaches an event or a signal
  Given a PreToolUse hook whose tool_input holds a secret
  And a Notification hook whose message holds a secret
  When they are parsed
  Then no event or signal contains the secret
```

## Live session registry
`<config>/sessions/<pid>.json` lists running sessions; an entry counts only when the OS confirms its pid is a live `claude` process.

Each file holds `{ pid, sessionId, cwd, startedAt }`. The check is `Get-Process` on Windows, and `ps` plus `lsof` or `/proc` elsewhere. It is polled every 3 s.

## Quota
Three feeds give the subscription's 5-hour and weekly usage: the OAuth `usage` endpoint, a one-token `probe` request, and the statusline push.

| Source | How | Notes |
|---|---|---|
| `usage` | `GET https://api.anthropic.com/api/oauth/usage`, with `Authorization: Bearer <token>` and `anthropic-beta: oauth-2025-04-20`. | Free. Needs the `user:profile` scope. `utilization` is a percentage and `resets_at` an ISO date. Gives `five_hour`, `seven_day`, and `seven_day_opus` / `seven_day_sonnet` when the plan has them. |
| `probe` | `POST /v1/messages`: 1 output token to `CLAUDE_MONITOR_QUOTA_PROBE_MODEL`, with Claude Code's system prompt. | Works with inference-only tokens (`claude setup-token`). Reads the `anthropic-ratelimit-unified-{5h,7d}-utilization` headers (a 0-1 fraction) and the matching `-reset` headers (Unix seconds). A 429 still yields a reading. Spends a sliver of the 5-hour window. |
| `statusline` | Claude Code pipes statusline JSON to `scripts/statusline.mjs`, which posts `rate_limits` to `POST /statusline`. | Push, free, no token. Only fires where a statusline is rendered. |

`CLAUDE_MONITOR_QUOTA_SOURCE=auto` tries `usage` first. On a 403 it switches to `probe` for the rest of the run. Refresh runs every `CLAUDE_MONITOR_QUOTA_INTERVAL` seconds (minimum 60) while any session is active, and four times less often when none is. Whichever reading is newest wins, from either feed.

```gherkin
@sc-quota-usage-endpoint
Scenario: the usage endpoint yields both windows and per-model weeks
  Given a token and a usage response with five_hour, seven_day and seven_day_opus
  When the quota is refreshed
  Then the reading has usedPct and resetsAt for each window and the per-model weeks
  And the token appears only in the Authorization header of the request

@sc-quota-auto-fallback
Scenario: auto falls back to probe when the token lacks the profile scope
  Given source auto and a usage endpoint answering 403
  When the quota is refreshed
  Then the probe request is made and its headers give the reading
  And later refreshes go straight to the probe

@sc-quota-probe-429
Scenario: a 429 from the probe still yields a reading
  Given a probe response with status 429 and rate-limit headers
  When the quota is refreshed
  Then the reading is taken from the headers and the status is ok

@sc-quota-error-keeps-last
Scenario: failures keep the last reading and never leak the token
  Given a good reading, then a network error or a 500
  When the quota is refreshed
  Then the status is error, the last windows are kept
  And neither the error message nor the quota object contains the token

@sc-quota-not-configured
Scenario: no token or source off means not configured and no network
  Given no token, or CLAUDE_MONITOR_QUOTA_SOURCE=off
  When the quota is refreshed
  Then the status is not_configured and fetch is never called

@sc-quota-statusline-feed
Scenario: the statusline feed updates the quota
  Given a statusline payload with rate_limits
  When it is applied
  Then the quota has source statusline, the windows from the payload, and quota_updated is emitted

@sc-statusline-junk-ignored
Scenario: statusline parsers ignore junk
  Given payloads that are not objects, lack rate_limits, or carry non-numeric values
  When they are parsed
  Then they yield no reading
```
