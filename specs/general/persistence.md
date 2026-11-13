# Persistence

SQLite holds only what transcripts cannot give back: the activity tracker's snapshot and the quota history.

## Database
One `node:sqlite` database in WAL mode at `<CLAUDE_MONITOR_DATA_DIR>/monitor.db` (default `./data/`, git-ignored), with a versioned schema.

The schema is versioned in `meta.schema_version`, and migrations live in `infra/db.ts`.

| Table | Holds | Lifetime |
|---|---|---|
| `activity` | Per-session tracker snapshot: phase, since, tool, agents, stop and end times. Written in 2 s batches. | Rows untouched for 30 days are deleted at start. |
| `quota_samples` | Every good quota reading. | Kept, for history. |

On start, saved activity is restored before transcripts are scanned, so the order rule (`activity-and-status.md#phases`, rule 1) keeps what hooks said. The database never holds transcript content.

```gherkin
@sc-db-restores-state
Scenario: the state database keeps activity and quota across restarts
  Given activity snapshots and quota samples written to a database
  When the activity is loaded
  Then each session's saved phase, source and agents come back
  When the latest quota is asked for after an error sample
  Then the last good reading is returned, not the error
  And the history query returns only the samples since the given time
```
