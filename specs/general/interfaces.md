# Interfaces

A local REST API, two POST intakes for hooks and statusline, and one Server-Sent Events stream.

## REST
Every route is read-only except the two intakes and the quota refresh.

| Method and path | Returns |
|---|---|
| `GET /api/meta` | `{ protocolVersion, quotaConfigured, quotaAlerts }` |
| `GET /api/sessions` | `Session[]`, most recent first |
| `GET /api/sessions/:id?before=&limit=` | `{ session, events, nextBefore, usageSeries }`. Events are paged (default 200, max 1000). |
| `GET /api/sessions/:id/graph?group=0` | `{ nodes, edges }` for the flow graph. Grouping of repeated tools is on by default. |
| `GET /api/sessions/:id/git` | Branch, ahead/behind, dirty files, last 10 commits, worktrees, or `{ isRepo: false }`. 2 s timeout, 5 s cache. |
| `GET /api/processes` | Live `claude` processes `{ pid, cwd, startedAt, cpu, mem, sessionId }` |
| `GET /api/stats?range=today\|7d\|30d` | Tokens and cost per local day and model |
| `GET /api/sessions/:id/pipeline` | `PipelineStats`: counts per block of the loop, recent calls per tool category, MCP servers, subagents, context size, and the last turn's phases for the replay |
| `GET /api/quota` | `Quota` |
| `GET /api/quota/history?days=7` | `QuotaSample[]` from `quota_samples` (1-90 days) |
| `GET /api/quota/attribution?since=<ISO>` | Each session's tokens and estimated cost since that time, heaviest first |
| `POST /api/quota/refresh` | Forces a pull. 409 when not configured. |
| `POST /event` | Hook payload. Answers 204 at once. |
| `POST /statusline` | Statusline payload. Answers 204 at once. |

## Git state
The git route runs `git` in the session's cwd with a 2 s timeout and a 5 s cache, and parses porcelain output.

```gherkin
@sc-git-status-parse
Scenario: the status header is parsed in all its forms
  Given `git status -sb` output whose header is "main...origin/main [ahead 2, behind 1]", "No commits yet on main", a plain branch, or "HEAD (no branch)"
  When it is parsed
  Then the branch is read in every form, ahead and behind default to 0
  And each following line becomes a dirty file with its two-letter status and path

@sc-git-worktrees
Scenario: worktrees are listed
  Given the porcelain output of `git worktree list`
  When it is parsed
  Then each worktree yields its path, its head shortened to 7 characters, and its branch name without refs/heads/
  And a detached worktree has no branch

@sc-git-not-a-repo
Scenario: a non-git directory and a missing one report not a repo
  Given a directory with no repository, or a path that does not exist
  When the git state is requested
  Then the answer is { isRepo: false } and nothing throws
```

## Flow graph
`GET /api/sessions/:id/graph` builds a graph of turns, tools and subagents from the session's events.

```gherkin
@sc-graph-turns-and-tools
Scenario: turns chain from the session and tools hang from their turn
  Given a session with two user turns, each with tool calls
  When the graph is built
  Then the session node links to the first turn, each turn to the next
  And each tool node links from its turn

@sc-graph-subagent-node
Scenario: an Agent call becomes a subagent node that owns the sidechain's tools
  Given an Agent tool call followed by sidechain events with its agentId
  When the graph is built
  Then there is one subagent node under the Agent call
  And the sidechain's tool calls hang from that subagent node

@sc-graph-orphan-agent
Scenario: an agent with no known parent call hangs from the session
  Given sidechain events whose agentId matches no Agent call
  When the graph is built
  Then the subagent node links from the session node

@sc-graph-fold-repeated-tools
Scenario: more than 8 calls in a turn fold repeated tools
  Given a turn with 12 Read calls and one Edit
  When the graph is built with grouping on
  Then the Reads become one group node labelled "12 x Read"
  When the graph is built with grouping off
  Then every call is its own node

@sc-graph-small-turn-unfolded
Scenario: 8 calls or fewer stay individual
  Given a turn with 8 calls of the same tool
  When the graph is built with grouping on
  Then no group node is created

@sc-graph-running-node
Scenario: an unanswered tool is running only while the session is active
  Given a tool_use event with no tool_result
  When the session is active
  Then the node's status is running
  When the session is idle or ended
  Then the node's status is not running

@sc-graph-edges-valid
Scenario: every edge joins existing nodes
  Given any session's graph
  Then each edge's source and target are ids of nodes in the graph
```

## Pipeline stats
`GET /api/sessions/:id/pipeline` aggregates the session's events into counts per loop block and the last turn's phases.

```gherkin
@sc-pipeline-counts
Scenario: calls are counted per category, per MCP server and per subagent
  Given tool calls of several categories, MCP tools from two servers, and an Agent call with sidechain tools
  When the pipeline stats are built
  Then each category block has its count and recent calls
  And each MCP server has its own count
  And each subagent has its own count

@sc-pipeline-context-window
Scenario: context is the latest main message's prompt size and the window grows past 200K
  Given assistant messages on the main transcript and one compaction
  When the pipeline stats are built
  Then the context size is the latest main message's input plus cache-read tokens
  And the context window is the model's window from models.json (200K)
  And the compactions counter is 1
  Given a session seen with more tokens than that window
  Then the context window is the 1M-token variant

@sc-pipeline-replay-last-turn
Scenario: replay covers only the last turn and ends waiting
  Given a session with two turns, the last with thinking, an MCP tool call, a subagent's tool call and text
  When the replay steps are computed
  Then they are requesting, thinking, tool, requesting, writing, waiting_input
  And the tool step names the MCP server
  And the subagent's own tool calls add no step
```

## Stream
`GET /stream` is Server-Sent Events; every message is `{ type, ... }` and the SSE event name equals `type`.

| Type | Payload | When |
|---|---|---|
| `hello` | `{ version }` | On connect. A client built for another `PROTOCOL_VERSION` reloads, at most once a minute. |
| `session_updated` | `{ session }` | Any change to a visible session. |
| `event_added` | `{ event }` | A new event. |
| `activity_changed` | `{ sessionId, activity }` | The shown activity changed. Light enough for animation. |
| `process_changed` | `{ processes }` | The process list changed. |
| `quota_updated` | `{ quota }` | A new reading, or an error. |

A 20 s comment heartbeat keeps proxies from closing the stream. After a reconnect, clients refetch what they show. Any change in message shape bumps `PROTOCOL_VERSION`.
