# Operations

Build, run, install the hooks and statusline, scan transcripts from the CLI, test and typecheck.

## Commands
Everything runs through npm scripts at the repo root.

```
npm install
npm run build && npm start        # UI and API on http://127.0.0.1:4317
npm run dev                       # server :4317 + Vite :5173 with proxy
npm run hooks:install             # print the hooks block
npm run hooks:install -- --write [--statusline]   # merge into ~/.claude/settings.json (backup first)
npm run hooks:install -- --check  # installed config up to date?
npm run hooks:install -- --uninstall
npm run scan [-- --check]         # CLI table; --check compares cost with Claude Code's own
npm test                          # server tests
npm run typecheck                 # all packages
```

## Installer
The installer only touches what it added, finds its hooks by their curl command on any port, and never overwrites an existing statusline.

It finds its hooks by their `curl … http://127.0.0.1:<port>/event` command on any port, and its statusline by a marker. So after a port change, `--write` moves everything to the new port, and `--check` reports hooks or a statusline that point elsewhere. It does not overwrite an existing statusline; it explains how to forward that one to the monitor instead.

## Platforms
Only Windows has been run; macOS and Linux paths exist but are untested.

Process stats use `Get-Process` on Windows, and `ps` plus `lsof` or `/proc` elsewhere.
