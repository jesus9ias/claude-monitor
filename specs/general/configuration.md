# Configuration

Every setting is an optional environment variable, read from `.env` at the repo root (template `.env.example`); variables already set in the environment take precedence.

## Variables
Ports, Claude Code paths, the data dir, and the quota token and tuning.

| Variable | Default | Meaning |
|---|---|---|
| `CLAUDE_MONITOR_PORT` | `4317` | Server port. Also read by the installer, which bakes it into the hooks and the statusline command, and by Vite's proxy |
| `CLAUDE_MONITOR_WEB_PORT` | `5173` | Vite dev server port (`npm run dev`) |
| `CLAUDE_CONFIG_DIR` | `~/.claude` | Claude Code config dir |
| `CLAUDE_MONITOR_PROJECTS_DIR` | `<config>/projects` | Transcripts |
| `CLAUDE_MONITOR_SESSIONS_DIR` | `<config>/sessions` | Live session registry |
| `CLAUDE_MONITOR_DATA_DIR` | `./data` | SQLite database |
| `CLAUDE_CODE_OAUTH_TOKEN` | unset | Subscription OAuth token, for the quota |
| `CLAUDE_MONITOR_QUOTA_SOURCE` | `auto` | `auto`, `usage`, `probe` or `off` |
| `CLAUDE_MONITOR_QUOTA_INTERVAL` | `300` | Seconds between refreshes while active (minimum 60) |
| `CLAUDE_MONITOR_QUOTA_PROBE_MODEL` | `claude-haiku-5-5` | Model for the probe |
| `CLAUDE_MONITOR_QUOTA_ALERTS` | `20,5` | Percent left that triggers a browser notification. `off` disables them |
| `CLAUDE_MONITOR_ENV_FILE` | `./.env` | Alternative env file |

```gherkin
@sc-config-quota-interval-clamp
Scenario: the quota settings are read and the interval is clamped
  Given a token with surrounding spaces, CLAUDE_MONITOR_QUOTA_SOURCE=PROBE and CLAUDE_MONITOR_QUOTA_INTERVAL=5
  When the config is loaded
  Then the token is trimmed, the source is lower-cased to probe
  And the interval is raised to the minimum of 60 seconds
  Given an unknown CLAUDE_MONITOR_QUOTA_SOURCE
  Then the source falls back to auto
```
