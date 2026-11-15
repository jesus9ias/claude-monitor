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

- One card per window (5-hour, weekly): percentage left, a level label (OK, getting low, almost out), a meter of the used part, and the reset countdown.
- **Pace**: a least-squares line over the window's readings since its last reset. The 5-hour window looks back 1 hour, the weekly window 24 hours. The card says when the window runs out at that rate and whether that comes before the reset. It needs at least two readings 5 minutes apart, and it is labelled as an estimate.
- Weekly windows per model, when the plan has them.
- History: used % of both windows over 7 days. A drop of more than 10 points in the 5-hour window is drawn as a reset. A table view is available.
- **Who used the current 5-hour window**: each session's share since the window started (reset time minus 5 hours), weighted by estimated API cost. Anthropic does not say how tokens map to quota percent, so this is a relative split.
- Alerts: the thresholds in use and a button to allow browser notifications. `useQuotaAlerts` (mounted at the app root) notifies once per window, reset and threshold, choosing the lowest threshold crossed. It only fires while a monitor tab is open.

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
The landing page: range picker, totals, cost by day, and the live session table.

Range picker (today, 7 days, 30 days), tiles (cost, tokens, active now), cost by day per model with a model share donut, and the session table (status, activity, project, model, tokens, cost, last activity). It updates live.

The session table has two views, chosen with a **History / By project** toggle (default History):
- **History**: one flat list, newest activity first.
- **By project**: sessions grouped by full `cwd` (same folder name in different paths stays apart), groups ordered by latest activity. Each group's header row shows the project name (full path on hover), session count, active count, summed in + out and cache tokens, summed cost (`n/a` if any session's cost is unknown) and latest activity. A header collapses and expands its group by mouse or keyboard; groups start expanded.
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

## Session view
`/sessions/:id/:tab` shows the session header and one of four tabs: Overview, Events, Flow, Pipeline.

The header shows title, cwd, branch, model, entrypoint, pid, status and the live activity.

### Overview tab
Usage tiles, tokens over time, git panel, usage by model.

### Events tab
Paged event list, newest first; hook events hidden unless shown; a row expands to its truncated detail.

### Flow tab
A dagre-laid-out graph of turns → tools and subagents, updated live without moving the viewport.

More than 8 calls in a turn fold into groups ("12 x Read"). Containers expand and collapse; clicking a node opens a drawer with status, duration, tokens, model, and the truncated input and result. Running nodes pulse.

### Pipeline tab
A fixed SVG diagram of the session's loop whose blocks light up and whose edges carry particles for the current phase.

The geometry and the phase → animation mapping live in `web/src/pages/session/pipeline/layout.ts`, as pure code.

- **Blocks**: You, Model, Output, Context, Tool router, Needs input, and one block per tool category (Read files, Search, Write code, Shell, Web, MCP, Skill, Subagents, Planning, Other). Each shows a session counter. Context has a fill bar against the model's context window, from `server/src/domain/models.json` (current Opus, Fable, Sonnet and Haiku models: 1M; any other model: 200K); a session seen above its window is taken to run the 1M-token variant.
- **Animation**: the blocks for the current phase light up, and particles run along the edges in use. Requesting animates You → Model, Router → Model after a tool, or Context → Model after compaction. Thinking pulses Model and draws from Context. Writing animates Model → Output. A tool animates Model → Router → its category, and MCP shows the server. A permission prompt animates Router → Needs input, and compaction pulses Context. Running subagents pulse Subagents.
- **Reduced motion**: blocks are still highlighted, but nothing moves.
- **Drawer**: clicking a block opens a drawer with the current call, counts, average and last duration, totals per tool, per MCP server or per subagent, and the last 20 calls.
- **Replay**: when the session is not active, "Replay last turn" plays the last turn's phases at 4x speed, each step held between 350 ms and 2 s. A session that becomes active ends the replay.
- **Live data**: the counters reload, debounced, on `event_added`. The phase comes from the session's live activity.
- Below 600 px the diagram scrolls horizontally inside its card.

## Client state
`web/src/state/live.ts` holds the session list, quota and meta for the whole app, kept current from the stream; data used by only one page stays in that page.
