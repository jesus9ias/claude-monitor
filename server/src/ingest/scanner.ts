import { open, readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { Monitor } from "../domain/monitor.js";
import { describeTranscript, parseLine, readSubagentMeta, type ParsedLine } from "./transcript.js";

const NEWLINE = 0x0a;

/** Reads transcripts incrementally. Keeps a byte offset per file; never reparses what it has read. */
export class Scanner {
  private readonly offsets = new Map<string, number>();
  private readonly inFlight = new Map<string, Promise<void>>();
  private readonly rerun = new Set<string>();
  malformedLines = 0;

  constructor(private readonly monitor: Monitor) {}

  async scanAll(root: string): Promise<number> {
    const files = await listTranscripts(root);
    for (const file of files) await this.readNew(file);
    return files.length;
  }

  /** Safe to call on every change event: overlapping calls for a file are coalesced. */
  readNew(file: string): Promise<void> {
    const running = this.inFlight.get(file);
    if (running) {
      this.rerun.add(file);
      return running;
    }
    const task = this.drain(file).finally(() => this.inFlight.delete(file));
    this.inFlight.set(file, task);
    return task;
  }

  private async drain(file: string): Promise<void> {
    do {
      this.rerun.delete(file);
      await this.readOnce(file);
    } while (this.rerun.has(file));
  }

  private async readOnce(file: string): Promise<void> {
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

    const lines: ParsedLine[] = [];
    let firstTs: string | undefined;
    for (const raw of chunk.subarray(0, end).toString("utf8").split("\n")) {
      if (!raw.trim()) continue;
      const parsed = parseLine(raw, ref);
      if (!parsed) {
        if (!isJson(raw)) this.malformedLines++;
        continue;
      }
      firstTs ??= parsed.ts;
      lines.push(parsed);
    }

    if (ref.agentId && firstTs) {
      // The meta file can land after the first transcript line, so retry until it has content.
      if (!this.monitor.agentMeta(ref.sessionId, ref.agentId)?.description) {
        this.monitor.linkAgent(ref.sessionId, ref.agentId, await readSubagentMeta(file), firstTs);
      }
      const meta = this.monitor.agentMeta(ref.sessionId, ref.agentId);
      lines.push({
        sessionId: ref.sessionId,
        agentId: ref.agentId,
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
    }
    if (lines.length) this.monitor.ingestLines(lines);
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
