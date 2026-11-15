import type { ToolCategory } from "@claude-monitor/shared";

/**
 * The one icon set of the UI: 24 px grid, 1.75 px stroke, round caps, currentColor.
 * One icon per concept, reused everywhere. Never emoji or an icon package.
 */
const PATHS = {
  // Navigation
  sessions: "M12 3 2 8l10 5 10-5-10-5z M2 13l10 5 10-5 M2 17.5l10 5 10-5",
  processes: "M7 7h10v10H7z M10 10h4v4h-4z M10 2v3 M14 2v3 M10 19v3 M14 19v3 M2 10h3 M2 14h3 M19 10h3 M19 14h3",
  quota: "M12 14l4-4 M3.5 18a9 9 0 1 1 17 0 M12 14h.01",
  // Metrics
  cost: "M12 2v20 M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6",
  tokens: "M4 9h16 M4 15h16 M10 3 8 21 M16 3l-2 18",
  cache:
    "M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3z M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6 M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3",
  time: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M12 7v5l3 2",
  memory: "M5 7h14v10H5z M8 4v3 M12 4v3 M16 4v3 M8 17v3 M12 17v3 M16 17v3",
  // Context
  project: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  branch: "M6 3v12 M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M18 9a9 9 0 0 1-9 9",
  model: "M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z M19 16v4 M17 18h4",
  you: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M4 21a8 8 0 0 1 16 0",
  context: "M4 5h16 M4 10h16 M4 15h10 M4 20h7",
  output: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",
  router: "M6 21a2 2 0 1 0 0-4 2 2 0 0 0 0 4z M18 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4z M8 19h7a3.5 3.5 0 0 0 0-7H9a3.5 3.5 0 0 1 0-7h7",
  hook: "M18 4v7a6 6 0 0 1-12 0V9 M6 9l-3 3 M6 9l3 3",
  pulse: "M3 12h4l3-8 4 16 3-8h4",
  calendar: "M4 6h16v14H4z M4 10h16 M8 3v4 M16 3v4",
  trend: "M7 17 17 7 M8 7h9v9",
  bell: "M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9 M10.3 21a1.9 1.9 0 0 0 3.4 0",
  // Session view tabs
  overview: "M4 4h7v7H4z M13 4h7v7h-7z M4 13h7v7H4z M13 13h7v7h-7z",
  events: "M8 6h13 M8 12h13 M8 18h13 M3 6h.01 M3 12h.01 M3 18h.01",
  flow: "M5 3h6v5H5z M13 16h6v5h-6z M8 8v4h8v4",
  // Tool categories
  read: "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z M14 3v5h5 M9 13h6 M9 17h6",
  search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z M21 21l-4.3-4.3",
  edit: "M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z M15 5l4 4",
  shell: "M4 17l6-5-6-5 M12 19h8",
  web: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M3 12h18 M12 3a14 14 0 0 1 0 18 M12 3a14 14 0 0 0 0 18",
  mcp: "M9 2v6 M15 2v6 M6 8h12v3a6 6 0 0 1-12 0z M12 17v5",
  skill: "M13 2 4 14h7l-1 8 9-12h-7z",
  agent: "M12 8V4H8 M5 8h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z M2 13h2 M20 13h2 M9 13v2 M15 13v2",
  planning: "M3 6l2 2 3-3 M3 16l2 2 3-3 M12 7h9 M12 17h9",
  other: "M5 12h.01 M12 12h.01 M19 12h.01",
  // States
  ok: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M8.5 12.5l2.5 2.5 5-5",
  error: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M9 9l6 6 M15 9l-6 6",
  warning: "M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z M12 9v4 M12 17h.01",
  input: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M12 11v5 M12 8h.01",
  // Actions
  refresh: "M21 12a9 9 0 1 1-2.6-6.4 M21 3v6h-6",
  sort: "M8 4v16 M4 8l4-4 4 4 M16 20V4 M12 16l4 4 4-4",
  sortUp: "M12 19V5 M6 11l6-6 6 6",
  sortDown: "M12 5v14 M6 13l6 6 6-6",
  filter: "M3 5h18l-7 8v6l-4 2v-8z",
  copy: "M9 9h11v11H9z M5 15H4V4h11v1",
  open: "M14 4h6v6 M20 4 10 14 M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5",
  fit: "M4 9V4h5 M20 9V4h-5 M4 15v5h5 M20 15v5h-5",
  play: "M7 4v16l13-8z",
  pause: "M8 5v14 M16 5v14",
  previous: "M18 6 8 12l10 6z M5 5v14",
  next: "M6 6l10 6-10 6z M19 5v14",
  chevronRight: "M9 6l6 6-6 6",
  close: "M6 6l12 12 M18 6 6 18",
  plus: "M12 5v14 M5 12h14",
  minus: "M5 12h14",
  download: "M12 4v12 M7 11l5 5 5-5 M5 20h14",
} as const;

export type IconName = keyof typeof PATHS;

/** Icon per tool category, the same in tables, events, flow and pipeline. */
export const CATEGORY_ICON: Record<ToolCategory, IconName> = {
  read: "read",
  search: "search",
  edit: "edit",
  shell: "shell",
  mcp: "mcp",
  skill: "skill",
  agent: "agent",
  web: "web",
  planning: "planning",
  other: "other",
};

/**
 * Decorative by default (`aria-hidden`). Pass `label` when the icon carries meaning on its own;
 * icon-only buttons put their `aria-label` on the button instead.
 */
export function Icon({ name, size = 18, label, className }: { name: IconName; size?: number; label?: string; className?: string }) {
  return (
    <svg
      className={className ? `icon ${className}` : "icon"}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
