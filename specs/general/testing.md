# Testing

Server tests with `node:test` under `server/test/`, driven by synthetic data and fake clocks; no test touches the network, the real `~/.claude`, or `.env`.

## Approach
Each layer is tested at its boundary with synthetic inputs; scenario tags link tests to the spec.

- `server/test/*.test.ts` with `node:test`, run by `npm test`.
- Parsers are tested with synthetic lines, including malformed ones. Tests also prove that payload content never reaches events and that the token never reaches a `Quota`.
- Activity and status are driven through `Monitor` with fixed clocks, covering hook order, late transcript lines, parallel and overtaking tools, subagents, permission prompts and compaction.
- Quota is tested with a fake `fetch`: usage, the 403 → probe fallback, 429, network errors, and statusline readings. Pace projection, alert selection and attribution are tested as pure functions.
- Pipeline aggregates and the replay steps are tested from synthetic events and transcript lines.
- The database is tested in memory.
- The web package has no automated tests; UI behavior in `user-interface.md` is verified by hand.

## Traceability
Every Gherkin scenario in this spec carries a stable `@sc-` tag, and the test that covers it carries the same tag in a comment above it.

`flow drift` lists scenarios with no test and test tags unknown to the spec. A ticket that changes a scenario updates the tag's text in the spec and the test in the same commit.
