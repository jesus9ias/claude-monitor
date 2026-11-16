---
id: CLM-5                       # assigned by `flow new`, never by hand
title: "Glass Dark foundations: dark-only theme, icon set and app shell"
type: change                   # feature | change | bug | refactor | chore
status: done               # draft | approved | in_progress | validating | done | blocked | cancelled
priority: medium           # low | medium | high | critical

# Placement
epic: CLM-6                   # KEY-n of an epic, or null
subproject: [web]       # one or several, e.g. [frontend, backend]; [] if single project
module: [user-interface, top-bar]
feature: [theme, iconography, app-shell]

# People and date
assignee: null
requester: null
commitment_date: null   # YYYY-MM-DD. The only hand-set date; change it with `flow set` (needs a reason). created/started/finished come from the log.

# Relationships: hand-written side
depends_on: []       # tickets that must be done first
supersedes: []       # tickets whose definition this one replaces

# Relationships: STAMPED BY `flow index`, never edit by hand
blocks: [CLM-7, CLM-8, CLM-9, CLM-10]
superseded_by: null
obsolete: false

# What this ticket may touch (drives reading, contradiction check and loop guards)
touches:
  spec: [user-interface.md, user-interface.md#top-bar]
  scenarios: []
  code_scope: [web/src/styles/**, web/src/components/Icon.tsx, web/src/components/SideNav.tsx, web/src/api.ts, web/src/components/common.tsx, web/src/components/QuotaIndicator.tsx, web/src/main.tsx, web/index.html, web/package.json, package-lock.json, specs/general/user-interface.md, CLAUDE.md]

# Closure gate: set after implementation (required before done)
claude_md: updated               # pending | updated | unchanged
---

# CLM-5 · Glass Dark foundations: dark-only theme, icon set and app shell

## Why
The author wants the monitor in one dark theme with glassmorphism (no light theme, no theme switch) and one icon language. This ticket lays the shared base that every view ticket in CLM-6 builds on, following the author's Glass Dark design proposal.

## Current behavior
See `user-interface.md` (intro): the UI follows the system light or dark theme. `user-interface.md#top-bar`: a top bar with text navigation and the quota readout. There are no icons beyond a text chevron, and cards are plain.

## Requested change
**Theme and tokens**
- One dark theme only. The UI no longer follows `prefers-color-scheme`; `color-scheme: dark` is set on the root. This replaces "follows the system light or dark theme" in the `user-interface.md` intro and "follows the system theme" in `CLAUDE.md`.
- Ground: ink `#07080C` with three soft radial lights (ember, iris, teal) fixed behind the content.
- Glass card: white 7%→3% gradient fill, 1 px white 9% border, inner top highlight, `backdrop-filter: blur(24px) saturate(150%)`, radius 18. Controls inside a card are flat 5% white, radius 12, no blur; tracks and inputs are 25% black wells. Blur only on the outermost card. Without `backdrop-filter` support cards fall back to an opaque `#151722` surface.
- Signal colors: ember `#F59A6B` (accent, selection), iris `#8E9BFF` (model, focus ring), teal `#3DD6C0` (live, quota OK), amber `#F5C04E` (idle, getting low), rose `#FF7A90` (error, almost out), slate `#7C8297` (ended). Model series colors keep following the model, never its rank. All text passes 4.5:1 on the glass surface.
- Type: Space Grotesk for headings and big metrics, Inter for body, JetBrains Mono for ids, pids and paths; numbers tabular. Fonts are self-hosted from npm packages, with no request to a font CDN, in line with "local only".
- Shared components restyled on the tokens: card, tile, segmented control, button, chip, meter, chart tooltip, empty and error states, 2 px iris focus ring.
- Status is never color alone: Active = pulsing teal dot, Idle = amber ring, Ended = hollow slate dot, Error = triangle icon, each with its word (`StatusBadge`). `ActivityBadge` shows the tool-category icon. Only live things move, and nothing moves under reduced motion.
- Existing pages pick up the tokens as they are (no layout changes here), so no light surface remains anywhere.

**Icons**
- One inline SVG icon set in `web/src/components/Icon.tsx`: 24 px grid, 1.75 px stroke, round caps, `currentColor`, no icon dependency. Decorative icons are `aria-hidden`; icon-only buttons have an `aria-label`.
- One icon per concept: navigation (Sessions, Processes, Quota), metrics (cost, tokens, cache, time, memory), context (project, branch, model, you, context, output, tool router, hook), every tool category (Read, Search, Edit, Shell, Web, MCP, Skill, Subagents, Planning, Other), states (ok, error, warning, needs input) and actions (refresh, sort, filter, copy, open, fit, play, pause, previous, next).

**App shell**
- The top bar becomes a side menu: brand, navigation with icons and live counts (Sessions: n live, Processes: n), a compact quota card with both meters and the reset time, and the stream connection state. Below 768 px it becomes a bottom tab bar with the three destinations; touch targets are at least 44 px. The quota readout keeps its link to `/quota` and its "Quota not configured" state.

### Checklist
- [x] C1 — Dark-only theme and glass tokens on every page; no light surface or system-theme switch remains · · verify: manual · impl: yes · spec: yes
- [x] C2 — Shared components and status/activity badges restyled; status readable without color · · verify: manual · impl: yes · spec: yes
- [x] C3 — Icon.tsx holds the full icon set and the badges and navigation use it · · verify: manual · impl: yes · spec: yes
- [x] C4 — Side menu with live counts, quota card and stream state; bottom tab bar below 768 px · · verify: manual · impl: yes · spec: yes
- [x] C5 — Fonts load from the bundle, with no request leaving the machine · · verify: manual · impl: yes · spec: yes
- [x] C6 — The build passes · · verify: command(npm run build) · impl: yes · spec: yes

## Scenarios (after state)
None: the web package has no automated tests and no Gherkin scenario in `user-interface.md` changes; the author checks every item in the browser.

## Agent instructions impact
`CLAUDE.md` Conventions: "follows the system theme" becomes "dark theme only, glass tokens in `web/src/styles/`", plus a line that icons come from `web/src/components/Icon.tsx`, never emoji or an icon package. New dependencies: the self-hosted font packages.

## Out of scope
- The per-view table and chart changes: CLM-7, CLM-8, CLM-9 and CLM-10.
- A light theme or a theme switch.
- Anything that needs new server data: deltas against the previous period, the "saved vs no cache" estimate, the Pipeline time split, alert history.
- Any change to which data is shown, how it is computed, or the routes.

## Open questions

## Change log
Append-only. One row per change to the ticket, always with a reason. Written by `flow`, never by hand.

| Date | Action | Change | Reason |
|---|---|---|---|
| 2026-11-14 | created | status: null → draft | The author asked for a dark-only glassmorphism redesign of every view, with better tables, charts and icons, based on the Glass Dark design proposal |
| 2026-11-14 | refined | definition | Wrote the definition from the Glass Dark design proposal: dark-only theme, icon set and per-view table and chart UX, client-side only |
| 2026-11-14 | contradiction-check | check | One intended change to a standard: user-interface.md#user-interface and CLAUDE.md say the UI follows the system light or dark theme; the author asked for a dark-only design with no theme change, so the ticket replaces that rule and declares the section in touches. CLM-3 and CLM-4 behavior (By project, range filter) is kept, so nothing is superseded. No open tickets overlap. |
| 2026-11-14 | refined | definition | Point touches.spec at user-interface.md itself for the intro paragraph, which has no heading anchor |
| 2026-11-14 | contradiction-check | check | Unchanged outcome: dark-only replaces the follow-the-system-theme rule in the user-interface.md intro and CLAUDE.md, as the author asked; CLM-3 and CLM-4 behavior kept; no open tickets overlap |
| 2026-11-14 | set | epic: null → CLM-6 | Split into the Glass Dark epic; CLM-5 keeps the shared foundations |
| 2026-11-14 | set | title: Glass Dark: one dark glass theme, icon set and data UX across all views → Glass Dark foundations: dark-only theme, icon set and app shell | Narrowed to the foundations; the per-view changes move to their own tickets in CLM-6 |
| 2026-11-14 | refined | definition | Narrowed to the shared foundations (dark-only theme, tokens, fonts, icon set, app shell); per-view changes moved to CLM-7 to CLM-10 |
| 2026-11-14 | contradiction-check | check | One intended change to a standard: the user-interface.md intro and CLAUDE.md say the UI follows the system theme; the author asked for dark-only, declared in touches. Siblings CLM-7 to CLM-10 build on it and do not overlap its sections. No other open tickets overlap. |
| 2026-11-14 | status | status: draft → approved | The author approved the Glass Dark epic and all its tickets in chat |
| 2026-11-14 | status | status: approved → in_progress | Implementation started, first ticket of the epic |
| 2026-11-14 | refined | definition | Added web/src/api.ts (stream connection state) and web/src/components/SideNav.tsx to code_scope, as the author chose in chat |
| 2026-11-14 | set | claude_md: pending → updated | Conventions: dark theme only with tokens in base.css, icons from Icon.tsx, self-hosted fonts |
| 2026-11-14 | status | status: in_progress → validating | Implemented; manual items wait for the author's check in the browser |
| 2026-11-14 | item | C6.impl: no → yes | npm run build passes |
| 2026-11-14 | item | C6.spec: no → yes | user-interface.md intro and #top-bar |
| 2026-11-16 | item | C1.impl: no → yes | The author checked the Glass Dark design in the browser and approved it in chat on 2026-11-16 |
| 2026-11-16 | item | C1.spec: no → yes | user-interface.md intro and #top-bar |
| 2026-11-16 | item | C2.impl: no → yes | The author checked the Glass Dark design in the browser and approved it in chat on 2026-11-16 |
| 2026-11-16 | item | C2.spec: no → yes | user-interface.md intro and #top-bar |
| 2026-11-16 | item | C3.impl: no → yes | The author checked the Glass Dark design in the browser and approved it in chat on 2026-11-16 |
| 2026-11-16 | item | C3.spec: no → yes | user-interface.md intro and #top-bar |
| 2026-11-16 | item | C4.impl: no → yes | The author checked the Glass Dark design in the browser and approved it in chat on 2026-11-16 |
| 2026-11-16 | item | C4.spec: no → yes | user-interface.md intro and #top-bar |
| 2026-11-16 | item | C5.impl: no → yes | The author checked the Glass Dark design in the browser and approved it in chat on 2026-11-16 |
| 2026-11-16 | item | C5.spec: no → yes | user-interface.md intro and #top-bar |
| 2026-11-16 | status | status: validating → done | The author checked the Glass Dark design in the browser and approved it in chat on 2026-11-16 |
