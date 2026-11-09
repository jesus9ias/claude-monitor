import type { Activity } from "./activity.js";
import type { Quota } from "./quota.js";

export type SessionStatus = "active" | "idle" | "ended";

export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  /** All cache writes, whatever their TTL. */
  cacheCreate: number;
  /** The part of cacheCreate written with a 1h TTL, which has its own price. */
  cacheCreate1h: number;
}

export interface UsagePoint {
  ts: string;
  usage: Usage;
}

export interface Session {
  id: string;
  title?: string;
  cwd: string;
  gitBranch?: string;
  model?: string;
  /** Where the session runs: "cli", "claude-desktop", "sdk-py", ... as Claude Code reports it. */
  entrypoint?: string;
  status: SessionStatus;
  startedAt: string;
  lastEventAt: string;
  usage: Usage;
  /** Estimated cost. null when any used model has no price. */
  costUsd: number | null;
  usageByModel: Record<string, Usage>;
  subagents: string[];
  pid?: number;
  /** What the session is doing right now. Always present; "waiting_input" or "ended" when quiet. */
  activity: Activity;
}

export type EventKind =
  | "user"
  | "assistant"
  | "thinking"
  | "tool_use"
  | "tool_result"
  | "subagent_start"
  | "subagent_stop"
  | "hook";

export interface Event {
  id: string;
  sessionId: string;
  parentId?: string;
  ts: string;
  kind: EventKind;
  toolName?: string;
  toolUseId?: string;
  summary: string;
  /** Truncated tool input (tool_use) or output (tool_result). */
  detail?: string;
  isError?: boolean;
  isSidechain?: boolean;
  agentId?: string;
  usage?: Usage;
  model?: string;
}

export interface SessionDetail {
  session: Session;
  events: Event[];
  /** Pass as ?before= to get the previous page. Absent when there is no older page. */
  nextBefore?: string;
  /** One point per API message, oldest first. Events are paginated; this is not. */
  usageSeries: UsagePoint[];
}

export interface GitCommit {
  hash: string;
  author: string;
  relativeDate: string;
  subject: string;
}

export interface GitFile {
  status: string;
  path: string;
}

export interface GitWorktree {
  path: string;
  branch?: string;
  head?: string;
}

export type GitInfo =
  | { isRepo: false }
  | {
      isRepo: true;
      branch: string;
      dirty: GitFile[];
      ahead: number;
      behind: number;
      recentCommits: GitCommit[];
      worktrees: GitWorktree[];
    };

export interface ProcessInfo {
  pid: number;
  cwd?: string;
  startedAt?: string;
  cpu: number;
  /** Resident memory in bytes. */
  mem: number;
  sessionId?: string;
}

export type NodeStatus = "running" | "ok" | "error";
export type GraphNodeType = "session" | "turn" | "tool" | "subagent" | "group";

export interface GraphNodeData {
  label: string;
  status?: NodeStatus;
  durationMs?: number;
  tokens?: number;
  model?: string;
  summary?: string;
  input?: string;
  result?: string;
  /** Tools in a turn or subagent, or calls folded into a group. */
  count?: number;
  /** The turn or subagent this node belongs to. Collapsing that container hides this node. */
  container?: string;
  /** The calls folded into a group. */
  items?: GraphItem[];
  [key: string]: unknown;
}

export interface GraphItem {
  label: string;
  status?: NodeStatus;
  durationMs?: number;
  summary?: string;
  input?: string;
  result?: string;
}

export interface GraphNode {
  id: string;
  type: GraphNodeType;
  data: GraphNodeData;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export type StatsRange = "today" | "7d" | "30d";

export interface StatsRow {
  day: string;
  model: string;
  usage: Usage;
  costUsd: number | null;
}

export interface Stats {
  range: StatsRange;
  rows: StatsRow[];
}

export interface ServerMeta {
  protocolVersion: number;
  /** Whether quota can be fetched from Anthropic (a token is configured and the source is not "off"). */
  quotaConfigured: boolean;
  /** Remaining-percent thresholds that trigger a browser notification, highest first. Empty: off. */
  quotaAlerts: number[];
}

/**
 * Bump when a message changes shape. The server sends it in `hello`; a client built for another
 * version reloads instead of misreading the stream.
 */
export const PROTOCOL_VERSION = 2;

export type StreamMessage =
  | { type: "hello"; version: number }
  | { type: "session_updated"; session: Session }
  | { type: "event_added"; event: Event }
  | { type: "activity_changed"; sessionId: string; activity: Activity }
  | { type: "process_changed"; processes: ProcessInfo[] }
  | { type: "quota_updated"; quota: Quota };

export type StreamMessageType = StreamMessage["type"];

export const STREAM_MESSAGE_TYPES: readonly StreamMessageType[] = [
  "hello",
  "session_updated",
  "event_added",
  "activity_changed",
  "process_changed",
  "quota_updated",
];

export const emptyUsage = (): Usage => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheCreate: 0,
  cacheCreate1h: 0,
});

export const totalTokens = (u: Usage): number => u.input + u.output + u.cacheRead + u.cacheCreate;
