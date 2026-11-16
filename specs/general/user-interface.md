# User interface

A React single-page app with three pages (Sessions, Processes, Quota) and a per-session view with four tabs, kept live by the stream.

All text in the UI is in English. The layout is responsive down to 375 px and respects reduced motion: only live things move (the Active pulse, running flow nodes, the pipeline path), and nothing moves under `prefers-reduced-motion`.

**Glass Dark theme.** There is one dark theme only; the UI does not follow the system light or dark setting (`color-scheme: dark` on the root). Tokens live in `web/src/styles/base.css`:
- Ground: ink `#07080C` with three soft radial lights (ember, iris, teal) fixed behind the content.
- Glass card: white 7%→3% gradient, 1 px white 9% border, inner top highlight, `blur(24px) saturate(150%)`, radius 18. Blur only on the outermost card. Controls inside a card are flat 5% white, radius 12, no blur; tracks and inputs are 25% black wells. Without `backdrop-filter` support cards fall back to an opaque `#151722`.
- Signal colors: ember `#F59A6B` (accent, selection), iris `#8E9BFF` (model, focus ring), teal `#3DD6C0` (live, quota OK), amber `#F5C04E` (idle, getting low), rose `#FF7A90` (error, almost out), slate `#7C8297` (ended). Model series colors follow the model, never its rank. Text passes 4.5:1 on the glass surface.
- Type: Space Grotesk for headings and big metrics, Inter for body, JetBrains Mono for ids, pids and paths; numbers are tabular. The fonts are bundled from npm packages: no request leaves the machine.
- Focus: a 2 px iris ring with 2 px offset on every control.

**Status is never color alone.** `StatusBadge`: Active = pulsing teal dot, Idle = amber ring, Ended = hollow slate dot, Error = triangle icon, each with its word. `ActivityBadge` shows the tool-category icon (or the phase icon) with the activity.

**Icons.** One inline SVG set in `web/src/components/Icon.tsx` (24 px grid, 1.75 px stroke, round caps, `currentColor`, no icon dependency), one icon per concept: navigation, metrics, session context, every tool category, states and actions. Decorative icons are `aria-hidden`; icon-only buttons carry an `aria-label`.

## Top bar
The app shell's navigation: a side menu from 768 px up, a phone header and bottom tab bar below.

- **Side menu** (glass card, sticky): brand, the three destinations (Sessions, Processes, Quota) with icons and live counts ("n live" sessions, number of processes), a compact quota card, and the stream connection state (connected, connecting, reconnecting). Sessions stays selected inside a session view.
- **Quota card**: both windows (5-hour, weekly) with percentage left, level word (OK, getting low, almost out) and color, a meter of the used part and the reset time; the source and age in a tooltip, a "stale" chip after a failed refresh. It links to `/quota`. When there is no data it shows "Quota not configured".
- **Below 768 px**: a phone header (brand, stream dot, a quota chip with the tighter window's percentage left, linking to `/quota`) and a bottom tab bar with the three destinations; touch targets are at least 44 px.

## Quota page
`/quota` shows both windows, a pace projection, per-model weeks, 7-day history, the session split of the current 5-hour window, and alert settings.

- One card per window (5-hour, weekly): a radial gauge of the percentage left, the level as word, icon and color (OK, getting low, almost out), the used %, the reset countdown and the pace sentence.
- **Pace**: a least-squares line over the window's readings since its last reset. The 5-hour window looks back 1 hour, the weekly window 24 hours. The card says when the window runs out at that rate and whether that comes before the reset. It needs at least two readings 5 minutes apart, and it is labelled as an estimate.
- Weekly windows per model, when the plan has them: meters with marks at the configured alert thresholds.
- History: used % of both windows over 7 days, over shaded bands for getting low (70–90 % used) and almost out (90 % and up). A drop of more than 10 points in the 5-hour window is drawn as a reset. A "now" marker and a dashed projection at the current pace run to each window's reset (the weekly one at most 24 hours ahead, so the 7 days stay readable). A table view is available.
- **Who used the current 5-hour window**: each session's share since the window started (reset time minus 5 hours), weighted by estimated API cost, as a ranking of horizontal share bars; each row links to its session and shows tokens, output and cost under the title. Anthropic does not say how tokens map to quota percent, so this is a relative split.
- Alerts: the browser's notification permission as a status chip, the thresholds in use as chips, and a button to allow browser notifications. `useQuotaAlerts` (mounted at the app root) notifies once per window, reset and threshold, choosing the lowest threshold crossed. It only fires while a monitor tab is open.

```gherkin
@sc-quota-pace
Scenario: pace projects exhaustion from readings after the last reset
  Given readings of a window where an earlier high value drops to a low one (a reset) and then climbs steadily
  When the pace is projected
  Then the rate comes only from readings after the drop
  And the projection gives the exhaustion time at that rate and whether it falls before the reset
  Given a single reading
  Then there is no projection
  Given readings with a flat rate
  Then the projection has no exhaustion time

@sc-quota-attribution
Scenario: attribution weighs sessions by cost since the window start
  Given sessions with usage before and after the window start
  When attribution is computed since the window start
  Then only usage since that time counts, so a session with none before it is left out
  And sessions are ordered heaviest first

@sc-quota-alert-thresholds
Scenario: alert thresholds parse, dedupe and sort
  Given CLAUDE_MONITOR_QUOTA_ALERTS unset
  Then the thresholds are 20 and 5
  Given "5, 20,20,150,x"
  Then duplicates, values over 100 and non-numbers are dropped and the result is 20, 5 (descending)
  Given "off" or an empty string
  Then there are no thresholds

@sc-quota-alert-once-per-window
Scenario: quota alerts fire once per window reset, at the lowest crossed threshold
  Given thresholds 20 and 5 and a 5-hour window with 4 percent left
  When due alerts are computed with nothing notified yet
  Then exactly one alert is due, keyed by window, reset time and threshold 5
  When the same key has already been notified
  Then no alert is due
  Given no thresholds
  Then no alert is ever due
```

## Sessions page
The landing page: range picker, totals, usage by day, and the live session table.

Range picker (today, 7 days, 30 days) and four tiles, each with an icon: estimated cost and tokens (each with a sparkline of the range's daily rows), active now, and the **cache hit rate** (cache read / all input: input + cache read + cache write) for the range, with its daily sparkline. It updates live.

**Usage by day**: stacked bars per model with a **Cost / Tokens** toggle. The legend is clickable: a model can be hidden, and day totals and the average follow what is shown. Each bar has its day total above it and a dashed line marks the daily average; the tooltip lists each model and the total. Beside the chart, a by-model bar list (share and value over the range, heaviest first). A table view is available. Cost excludes models with no price.

**Session table**: status, session (title, project), model, **Doing now** (the activity with its tool-category icon), tokens (a stacked in / out / cache bar, scaled to the largest shown session), cost (a bar relative to the costliest shown row), last activity (absolute time on hover) and a row action that copies the session id.
- **Search** over project name, title and id; Ctrl K (Cmd K) focuses it.
- **Status chips** (All, Active, Idle, Ended) with counts of the sessions the search and model filter leave, and a **model filter**.
- **Sortable columns** (status, session, model, tokens, cost, last activity) with the direction shown; default last activity, newest first. The header stays visible while the table scrolls.
- A footer reads "Showing n of m", m being the sessions in the range, with a "Clear filters" link when a filter is on.
- The table scrolls sideways inside its card. Below 768 px rows become cards (status, title, project, model, activity, cost bar).
- Search, filters and sort apply to both views and combine with the range filter. They are client-side and not remembered across reloads.

The session table has two views, chosen with a **History / By project** toggle (default History):
- **History**: one flat list in the chosen sort order (default newest activity first).
- **By project**: sessions grouped by full `cwd` (same folder name in different paths stays apart), groups ordered by latest activity. Each group's header row shows the project name (full path on hover), session count, active count, summed tokens (in + out and cache split on hover), summed cost (`n/a` if any session's cost is unknown) and latest activity. A header collapses and expands its group by mouse or keyboard; groups start expanded.
- The chosen view and the collapsed groups are remembered per browser in `localStorage`; without storage the page still works and starts in History. Grouping is client-side only.

The session table follows the range picker:
- It shows only sessions whose last activity is at or after the range start (local midnight today, 6 days ago or 29 days ago, the same start as `/api/stats`). Active sessions are always shown.
- In By project, groups with no shown session are hidden and header totals sum only the shown sessions.
- Row tokens and cost stay whole-session, so the rows can add up to more than the range tiles.
- With sessions but none in the range it reads "No sessions in this range." Filtering is client-side and live, including when the local day turns over.

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

## Processes page
Live `claude` processes and the session each one belongs to; read-only.

- **Tiles**: processes (and how many are linked to a session), total CPU, total memory, unlinked processes.
- **Table**: sorted by CPU, highest first, by default; CPU and memory headers sort either way. CPU shows the value and a sparkline of the samples received since the page opened (page state, at most 60 per process, dropped when the process goes). Memory shows a bar relative to the largest process. The project cell shows the folder name and the full cwd in mono.
- A process with no session is tagged **Unlinked**, with a note explaining what that means.

## Session view
`/sessions/:id/:tab` shows the session header and one of four tabs: Overview, Events, Flow, Pipeline.

The header (a glass card) shows a breadcrumb back to Sessions, the title, status and live activity on the right, and chips with icons for the cwd (with a copy button), branch, model, entrypoint, pid and start time (full date on hover). The tabs carry icons and counts: Events shows the events loaded so far ("n+" while older pages exist, kept live from `event_added`), Flow the number of subagents when there are any.

### Overview tab
Usage tiles, tokens per message, cache efficiency, git panel, usage by model.

- **Tiles** with icons and a one-line context: cost (cost per hour of session time), input (fresh, not cached), output (share of all tokens), cache read (hit rate), cache write (share of input), subagents (how many run now).
- **Tokens per message**: one area chart of input, output and cache read per API message, with series toggles and a hover cursor.
- **Cache efficiency**: a ring of cache read / all input, with the cache read, cache write and fresh input figures.
- **Git**: branch chip with ahead, behind and uncommitted (or clean) chips; changed files grouped by change type (conflicted, untracked, renamed, deleted, added, modified), each with a type badge; recent commits and worktrees.
- **Usage by model**: one row per model with its in / out / cache split and a share bar. The share is of the session's tokens, since the UI has no per-model price; the session's main model is tagged.

### Events tab
A timeline of the loaded events, newest first.

- Each row: time, an icon per kind (tool calls by tool category, results, assistant, thinking, hook, subagent, error), the tool name, the summary, and output tokens (assistant) or duration (a result, from its call).
- Each user prompt starts a turn: a separator with its time, the prompt and the turn's tool-call and error counts.
- **Filter chips** with counts: All (everything but hooks, the default), Assistant, Tools, Hooks, Errors. **Search** over tool name and summary. Both work client-side on the loaded events, and the note under them says how many that is.
- Errors are highlighted in rose; subagent events are indented and tagged with the agent.
- A row with detail expands inline, with a Copy button and the "truncated by the parser" note.
- "Following live" while the newest event is in view; otherwise a "Jump to latest · n new" button counts events that arrived since. "Load older events" fetches the previous page.

### Flow tab
A dagre-laid-out graph of turns → tools and subagents, updated live without moving the viewport.

More than 8 calls in a turn fold into groups ("12 x Read"). Containers expand and collapse.

- **Nodes** are glass cards with an icon (tool category for calls and groups, you for turns, subagent, session), label, status and meta. The border shows status: running glows teal (and pulses unless reduced motion), error is rose, the selected node iris; subagents carry an iris edge.
- A fixed **legend** (running, ok, error, subagent) and grouped **controls**: zoom out / in with the zoom level, fit, expand all and collapse all. The minimap colors nodes by status.
- **Inspector**: clicking a node opens a side panel beside the graph (below it under 1100 px): kind, status, summary, duration, tokens, model, cost (the session node, the only one with a known cost), the tool calls under the node per category as bars, its failed calls, the truncated input and result, the folded calls of a group, and a link to Events searched for the node's tool (`?q=`).

### Pipeline tab
A fixed SVG diagram of the session's loop whose blocks light up and whose edges carry particles for the current phase.

The geometry and the phase → animation mapping live in `web/src/pages/session/pipeline/layout.ts`, as pure code.

- **Blocks**: You, Model, Output, Context, Tool router, Needs input, and one block per tool category (Read files, Search, Write code, Shell, Web, MCP, Skill, Subagents, Planning, Other). Each shows a session counter. Context has a fill bar against the model's context window, from `server/src/domain/models.json` (current Opus, Fable, Sonnet and Haiku models: 1M; any other model: 200K); a session seen above its window is taken to run the 1M-token variant.
- **Animation**: the blocks for the current phase light up, and particles run along the edges in use. Requesting animates You → Model, Router → Model after a tool, or Context → Model after compaction. Thinking pulses Model and draws from Context. Writing animates Model → Output. A tool animates Model → Router → its category, and MCP shows the server. A permission prompt animates Router → Needs input, and compaction pulses Context. Running subagents pulse Subagents.
- **Reduced motion**: no particles or pulses; the active path is shown by color alone.
- **Drawer**: clicking a block opens a drawer with the current call, counts, average and last duration, totals per tool, per MCP server or per subagent, and the last 20 calls.
- **Look**: every block carries its icon (category icons on the tool blocks). The active path takes the color of the block it leads to (iris to the model and router, ember to tools, amber to Needs input), and tool categories with no call in the session are dimmed.
- **Replay**: when the session is not active, "Replay last turn" plays the last turn's phases in a transport bar: previous / play-pause / next step, speed 1×, 2× or 4× (default 4×; at 4× each step is held 350 ms to 2 s, slower speeds stretch both bounds), and a timeline with one tick per step colored by phase (iris model, ember tool, amber input) that jumps on click. Playback pauses on the last step. "Back to live" ends the replay, and a session that becomes active ends it too.
- **Last turn by category**: beside the diagram (below it under 1100 px), the last turn's tool calls per category as bars with icons and the time spent, from the replay steps of the pipeline stats.
- **Live data**: the counters reload, debounced, on `event_added`. The phase comes from the session's live activity.
- Below 600 px the diagram scrolls horizontally inside its card.

## Client state
`web/src/state/live.ts` holds the session list, quota and meta for the whole app, kept current from the stream; data used by only one page stays in that page.
