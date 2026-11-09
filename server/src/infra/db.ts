/**
 * The monitor's own state, in SQLite: what transcripts cannot rebuild after a restart (activity set
 * by hooks) and history that Claude Code does not keep (quota readings). Transcripts stay the source
 * of truth for sessions, events and tokens; this file never holds transcript content.
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Quota } from "@claude-monitor/shared";
import type { TrackSnapshot } from "../domain/activity.js";

const SCHEMA_VERSION = 1;

const MIGRATIONS: Record<number, string> = {
  1: `
    CREATE TABLE activity (
      session_id TEXT PRIMARY KEY,
      data       TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE quota_samples (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      ts         TEXT NOT NULL,
      source     TEXT NOT NULL,
      five_hour  REAL,
      seven_day  REAL,
      data       TEXT NOT NULL
    );
    CREATE INDEX quota_samples_ts ON quota_samples (ts);
  `,
};

/** Activity older than this is of no use after a restart. */
const ACTIVITY_KEEP_DAYS = 30;

export class StateDb {
  private readonly db: DatabaseSync;

  constructor(file: string) {
    if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;");
    this.migrate();
  }

  static open(dataDir: string): StateDb {
    return new StateDb(path.join(dataDir, "monitor.db"));
  }

  private migrate(): void {
    this.db.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    const row = this.db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as { value: string } | undefined;
    let version = row ? Number(row.value) : 0;
    while (version < SCHEMA_VERSION) {
      version++;
      this.db.exec("BEGIN");
      try {
        this.db.exec(MIGRATIONS[version]!);
        this.db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', ?)").run(String(version));
        this.db.exec("COMMIT");
      } catch (err) {
        this.db.exec("ROLLBACK");
        throw err;
      }
    }
  }

  saveActivity(rows: { sessionId: string; snapshot: TrackSnapshot }[]): void {
    if (!rows.length) return;
    const stmt = this.db.prepare(
      "INSERT INTO activity (session_id, data, updated_at) VALUES (?, ?, ?) " +
        "ON CONFLICT(session_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at",
    );
    const now = new Date().toISOString();
    this.db.exec("BEGIN");
    try {
      for (const r of rows) stmt.run(r.sessionId, JSON.stringify(r.snapshot), now);
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  loadActivity(): Map<string, TrackSnapshot> {
    const cutoff = new Date(Date.now() - ACTIVITY_KEEP_DAYS * 86_400_000).toISOString();
    this.db.prepare("DELETE FROM activity WHERE updated_at < ?").run(cutoff);
    const out = new Map<string, TrackSnapshot>();
    for (const row of this.db.prepare("SELECT session_id, data FROM activity").all() as { session_id: string; data: string }[]) {
      try {
        out.set(row.session_id, JSON.parse(row.data) as TrackSnapshot);
      } catch {
        // A row from an older shape: drop it, the transcript will rebuild what it can.
      }
    }
    return out;
  }

  addQuotaSample(quota: Quota): void {
    if (quota.status !== "ok" || !quota.fetchedAt || !quota.source) return;
    this.db
      .prepare("INSERT INTO quota_samples (ts, source, five_hour, seven_day, data) VALUES (?, ?, ?, ?, ?)")
      .run(quota.fetchedAt, quota.source, quota.fiveHour?.usedPct ?? null, quota.sevenDay?.usedPct ?? null, JSON.stringify(quota));
  }

  latestQuota(): Quota | undefined {
    const row = this.db.prepare("SELECT data FROM quota_samples ORDER BY ts DESC LIMIT 1").get() as { data: string } | undefined;
    if (!row) return undefined;
    try {
      return JSON.parse(row.data) as Quota;
    } catch {
      return undefined;
    }
  }

  quotaHistory(sinceIso: string): { ts: string; fiveHour: number | null; sevenDay: number | null }[] {
    return (
      this.db.prepare("SELECT ts, five_hour, seven_day FROM quota_samples WHERE ts >= ? ORDER BY ts").all(sinceIso) as {
        ts: string;
        five_hour: number | null;
        seven_day: number | null;
      }[]
    ).map((r) => ({ ts: r.ts, fiveHour: r.five_hour, sevenDay: r.seven_day }));
  }

  close(): void {
    this.db.close();
  }
}
