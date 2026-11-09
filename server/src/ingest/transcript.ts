/**
 * The ONLY place that knows the Claude Code transcript format, which is undocumented.
 * When a Claude Code update breaks something, fix it here.
 *
 * Observed layout:
 *   <projects>/<encoded-cwd>/<sessionId>.jsonl
 *   <projects>/<encoded-cwd>/<sessionId>/subagents/agent-<agentId>.jsonl  (+ .meta.json)
 *
 * Observed quirks:
 *   - One assistant API message spans several lines, one per content block. Every line repeats the
 *     same message.id and usage, and a later line can carry updated usage. Summing lines double-counts.
 *   - Many line types are not conversation (attachment, mode, ...) and are ignored. A few carry no
 *     content but mark a phase: api-request (a call to the model went out), system/compact_boundary
 *     (compaction finished), system/stop_hook_summary (the turn ended).
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Event, Usage } from "@claude-monitor/shared";

const SUMMARY_MAX = 120;
const DETAIL_MAX = 1000;

export interface TranscriptRef {
  sessionId: string;
  agentId?: string;
}

export interface ParsedMessage {
  id: string;
  model: string;
  usage: Usage;
  speed?: string;
  ts: string;
}

/** A line with no conversation content that still says where the session is in its loop. */
export type TranscriptMarker =
  | { kind: "request" }
  | { kind: "turn_end" }
  | { kind: "compacted"; durationMs?: number }
  | { kind: "api_error" };

export interface ParsedLine {
  sessionId?: string;
  cwd?: string;
  gitBranch?: string;
  entrypoint?: string;
  ts?: string;
  /** Set for subagent transcripts. */
  agentId?: string;
  marker?: TranscriptMarker;
  events: Event[];
  message?: ParsedMessage;
  title?: { text: string; source: "custom" | "ai" };
  subagentLink?: { agentId: string; toolUseId: string };
  /** Claude Code's own running cost total, used only to sanity check our estimate. */
  reportedCostUsd?: number;
}

export interface SubagentMeta {
  toolUseId?: string;
  agentType?: string;
  description?: string;
}

/** Returns null for files that are not transcripts. */
export function describeTranscript(filePath: string): TranscriptRef | null {
  if (!filePath.endsWith(".jsonl")) return null;
  const base = path.basename(filePath, ".jsonl");
  const parent = path.dirname(filePath);
  if (path.basename(parent) === "subagents") {
    if (!base.startsWith("agent-")) return null;
    return { sessionId: path.basename(path.dirname(parent)), agentId: base.slice("agent-".length) };
  }
  return { sessionId: base };
}

export async function readSubagentMeta(filePath: string): Promise<SubagentMeta> {
  try {
    const raw = JSON.parse(await readFile(filePath.replace(/\.jsonl$/, ".meta.json"), "utf8"));
    return {
      toolUseId: str(raw.toolUseId),
      agentType: str(raw.agentType),
      description: str(raw.description),
    };
  } catch {
    return {};
  }
}

/** Never throws: malformed or unknown lines return null. */
export function parseLine(line: string, ref?: TranscriptRef): ParsedLine | null {
  let j: any;
  try {
    j = JSON.parse(line);
  } catch {
    return null;
  }
  if (j === null || typeof j !== "object") return null;

  try {
    const sessionId = str(j.sessionId) ?? ref?.sessionId;
    switch (j.type) {
      case "user":
      case "assistant":
        return parseConversationLine(j, sessionId, ref);
      case "custom-title":
        return titleLine(sessionId, j.customTitle, "custom");
      case "ai-title":
        return titleLine(sessionId, j.aiTitle, "ai");
      case "api-request":
        return markerLine(j, sessionId, ref, { kind: "request" });
      case "system":
        return parseSystemLine(j, sessionId, ref);
      case "cost-state":
        return typeof j.totalCostUSD === "number"
          ? { sessionId, events: [], reportedCostUsd: j.totalCostUSD }
          : null;
      default:
        return null;
    }
  } catch {
    return null;
  }
}

function markerLine(j: any, sessionId: string | undefined, ref: TranscriptRef | undefined, marker: TranscriptMarker): ParsedLine | null {
  const ts = str(j.timestamp);
  if (!sessionId || !ts) return null;
  return { sessionId, ts, agentId: ref?.agentId ?? str(j.agentId), events: [], marker };
}

function parseSystemLine(j: any, sessionId: string | undefined, ref?: TranscriptRef): ParsedLine | null {
  switch (j.subtype) {
    case "compact_boundary": {
      const durationMs = j.compactMetadata?.durationMs;
      return markerLine(j, sessionId, ref, { kind: "compacted", durationMs: typeof durationMs === "number" ? durationMs : undefined });
    }
    case "stop_hook_summary":
      return markerLine(j, sessionId, ref, { kind: "turn_end" });
    case "api_error":
      return markerLine(j, sessionId, ref, { kind: "api_error" });
    default:
      return null;
  }
}

function titleLine(sessionId: string | undefined, text: unknown, source: "custom" | "ai"): ParsedLine | null {
  return typeof text === "string" && text ? { sessionId, events: [], title: { text, source } } : null;
}

function parseConversationLine(j: any, sessionId: string | undefined, ref?: TranscriptRef): ParsedLine | null {
  const ts = str(j.timestamp);
  const uuid = str(j.uuid);
  if (!sessionId || !ts || !uuid) return null;

  const out: ParsedLine = {
    sessionId,
    cwd: str(j.cwd),
    gitBranch: str(j.gitBranch),
    entrypoint: str(j.entrypoint),
    ts,
    agentId: ref?.agentId ?? str(j.agentId),
    events: [],
  };
  const base = {
    sessionId,
    parentId: str(j.parentUuid),
    ts,
    isSidechain: j.isSidechain === true || undefined,
    agentId: ref?.agentId ?? str(j.agentId),
  };
  const content: unknown = j.message?.content;

  if (j.type === "assistant") {
    const model = str(j.message?.model);
    const usage = parseUsage(j.message?.usage);
    const id = str(j.message?.id);
    // "<synthetic>" marks locally generated error messages: no API call, no tokens.
    if (model && model !== "<synthetic>" && usage && id) {
      out.message = { id, model, usage, speed: str(j.message.usage.speed), ts };
    }
    const assistantModel = model === "<synthetic>" ? undefined : model;
    forEachBlock(content, (block, i) => {
      const id2 = `${uuid}:${i}`;
      if (block.type === "text") {
        out.events.push({ ...base, id: id2, kind: "assistant", model: assistantModel, summary: clip(str(block.text) ?? "") });
      } else if (block.type === "thinking") {
        out.events.push({ ...base, id: id2, kind: "thinking", model: assistantModel, summary: "(thinking)" });
      } else if (block.type === "tool_use") {
        const name = str(block.name) ?? "unknown";
        out.events.push({
          ...base,
          id: id2,
          kind: "tool_use",
          model: assistantModel,
          toolName: name,
          toolUseId: str(block.id),
          summary: clip(toolSummary(name, block.input)),
          detail: clipDetail(block.input),
        });
      }
    });
    return out;
  }

  // Injected context, not something the person typed.
  if (j.isMeta === true) return out;

  if (typeof content === "string") {
    out.events.push({ ...base, id: uuid, kind: "user", summary: clip(content) });
    return out;
  }
  forEachBlock(content, (block, i) => {
    const id2 = `${uuid}:${i}`;
    if (block.type === "text") {
      out.events.push({ ...base, id: id2, kind: "user", summary: clip(str(block.text) ?? "") });
    } else if (block.type === "tool_result") {
      const text = toolResultText(block.content);
      const toolUseId = str(block.tool_use_id);
      out.events.push({
        ...base,
        id: id2,
        kind: "tool_result",
        toolUseId,
        isError: block.is_error === true || undefined,
        summary: clip(text),
        detail: clipDetail(text),
      });
      const agentId = str(j.toolUseResult?.agentId);
      if (agentId && toolUseId) out.subagentLink = { agentId, toolUseId };
    }
  });
  return out;
}

function forEachBlock(content: unknown, fn: (block: any, index: number) => void): void {
  if (!Array.isArray(content)) return;
  content.forEach((block, i) => {
    if (block && typeof block === "object") fn(block, i);
  });
}

function parseUsage(u: any): Usage | null {
  if (!u || typeof u !== "object") return null;
  return {
    input: num(u.input_tokens),
    output: num(u.output_tokens),
    cacheRead: num(u.cache_read_input_tokens),
    cacheCreate: num(u.cache_creation_input_tokens),
    cacheCreate1h: num(u.cache_creation?.ephemeral_1h_input_tokens),
  };
}

function toolSummary(name: string, input: any): string {
  if (!input || typeof input !== "object") return name;
  const main =
    input.command ?? input.file_path ?? input.notebook_path ?? input.pattern ?? input.description ?? input.query ?? input.url;
  if (typeof main === "string") return main;
  const firstString = Object.values(input).find((v) => typeof v === "string");
  return typeof firstString === "string" ? firstString : name;
}

function toolResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((c: any) => (c?.type === "text" && typeof c.text === "string" ? c.text : c?.type ? `[${c.type}]` : ""))
    .join("\n");
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

function clip(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > SUMMARY_MAX ? `${oneLine.slice(0, SUMMARY_MAX)}…` : oneLine;
}

/** Transcripts may contain secrets: only a bounded prefix ever leaves this module. */
function clipDetail(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return text.length > DETAIL_MAX ? `${text.slice(0, DETAIL_MAX)}… [truncated]` : text;
}
