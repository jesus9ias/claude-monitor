import { open, readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { Event } from "@claude-monitor/shared";
import { describeTranscript, parseLine, readSubagentMeta } from "./parser/jsonl.js";
import type { SessionState, Store } from "./store.js";

const NEWLINE = 0x0a;

export type IngestListener = (state: SessionState, added: Event[]) => void;

/** Reads transcripts incrementally. Keeps a byte offset per file; never reparses what it has read. */
export class Scanner {
  private readonly offsets = new Map<string, number>();
  private readonly inFlight = new Map<string, Promise<void>>();
  private readonly rerun = new Set<string>();
  malformedLines = 0;

  constructor(private readonly store: Store) {}

  async scanAll(root: string, onIngest?: IngestListener): Promise<number> {
    const files = await listTranscripts(root);
    for (const file of files) await this.readNew(file, onIngest);
    return files.length;
  }

  /** Safe to call on every change event: overlapping calls for a file are coalesced. */
  readNew(file: string, onIngest?: IngestListener): Promise<void> {
    const running = this.inFlight.get(file);
    if (running) {
      this.rerun.add(file);
      return running;
    }
    const task = this.drain(file, onIngest).finally(() => this.inFlight.delete(file));
    this.inFlight.set(file, task);
    return task;
  }

  private async drain(file: string, onIngest?: IngestListener): Promise<void> {
    do {
      this.rerun.delete(file);
      await this.readOnce(file, onIngest);
    } while (this.rerun.has(file));
  }

  private async readOnce(file: string, onIngest?: IngestListener): Promise<void> {
    const ref = describeTranscript(file);
    if (!ref) return;

    let size: number;
    try {
      size = (await stat(file)).size;
    } catch {
      return; // Deleted between the event and the read.
    }
    let offset = this.offsets.get(file) ?? 0;
    if (size < offset) offset = 0; // Truncated or replaced. Ingest is idempotent, so rereading is safe.
    if (size === offset) return;

    const handle = await open(file, "r");
    let chunk: Buffer;
    try {
      chunk = Buffer.alloc(size - offset);
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, offset);
      chunk = chunk.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }

    // A line still being written has no newline yet: leave it for the next read.
    const end = chunk.lastIndexOf(NEWLINE);
    if (end === -1) return;
    this.offsets.set(file, offset + end + 1);

    const touched = new Map<SessionState, Event[]>();
    let firstTs: string | undefined;
    for (const line of chunk.subarray(0, end).toString("utf8").split("\n")) {
      if (!line.trim()) continue;
      const parsed = parseLine(line, ref);
      if (!parsed) {
        if (!isJson(line)) this.malformedLines++;
        continue;
      }
      firstTs ??= parsed.ts;
      const result = this.store.ingest(parsed);
      if (!result) continue;
      const list = touched.get(result.state) ?? [];
      list.push(...result.added);
      touched.set(result.state, list);
    }

    if (ref.agentId && firstTs) {
      const state = this.store.ensure(ref.sessionId, firstTs);
      // The meta file can land after the first transcript line, so retry until it has content.
      if (!state.agents.get(ref.agentId)?.description) {
        this.store.linkAgent(state, ref.agentId, await readSubagentMeta(file));
      }
      const meta = state.agents.get(ref.agentId);
      const result = this.store.ingest({
        sessionId: ref.sessionId,
        events: [
          {
            id: `subagent_start:${ref.agentId}`,
            sessionId: ref.sessionId,
            ts: firstTs,
            kind: "subagent_start",
            summary: meta?.description ?? ref.agentId,
            isSidechain: true,
            agentId: ref.agentId,
          },
        ],
      });
      if (result?.added.length) touched.set(state, [...(touched.get(state) ?? []), ...result.added]);
    }
    if (onIngest) for (const [state, added] of touched) onIngest(state, added);
  }
}

function isJson(line: string): boolean {
  try {
    JSON.parse(line);
    return true;
  } catch {
    return false;
  }
}

export async function listTranscripts(root: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (describeTranscript(full)) out.push(full);
    }
  };
  await walk(root);
  return out;
}
