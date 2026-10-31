---
status: accepted
date: 2026-10-31
---

# A local timing log of every data-server tool call

Sessions feel slow, and nothing recorded how long each tool call takes. Session entry returns its own phase timings, and three tools wrote them to stderr (`[timings]`, #579), but nothing showed server time against model time across a working week. This is the measurement layer. The speed fixes are in spec `2026-10-29_open-session-server-time-spec.md`.

## Decisions

- **D1. One wrapping point.** The data server has one `CallToolRequestSchema` handler (`src/index.ts`), and every tool goes through `dispatchTool`. `withCallLog` (`src/call-log.ts`) wraps that one handler, so no tool logs itself and a new tool is logged with no extra work. Tests that call `dispatchTool` directly write no log.
- **D2. Daily JSON-lines files, not SQLite.** The server reaches SQLite only by starting the host Python, which takes far longer than most calls. Node 20 has no built-in SQLite and adding one would mean a new dependency. A JSON line appended with `appendFileSync` needs neither. Each record is one short append to a file opened for appending, so servers in several sessions share a file safely. Daily files make retention a matter of deleting a file, with no rewrite.
- **D3. Folder.** `%LOCALAPPDATA%\Coclerk\call-log\YYYY-MM-DD.jsonl` (the home folder when `LOCALAPPDATA` is unset), next to the server's other local state (`extract-results`, the data locks). It is per user, does not roam, and is never under the case data root or a matter folder.
- **D4. Nothing from the call, structurally.** `callRecord` never receives the arguments. From the reply it keeps only the length, the error code if it matches `[a-z_]+`, and the top-level `timings`. Phase names that are not lower-case code text, such as `write <file name>`, are cut to their first word and `*`. A tool name the server does not define is logged as `unknown`. A record holds the time, tool, duration, outcome, size, error code, phases, build stamp and session hash, and nothing else.
- **D5. Outcome.** `ok`. Or `refused`: a tool raised its own `DataServerError`. Or `error`: anything else, an `internal_error`, a `python_timeout`, or a dispatch that threw. `toolReply` marks a fault with a symbol property that never goes over the wire, because the reply text says `data_error` for both kinds.
- **D6. Session.** The first 16 hex characters of a SHA-256 of `CLAUDE_CODE_SESSION_ID`, or of a random UUID per server process when the host does not set it. Each session starts its own server, so either way the calls group by session.
- **D7. Self-cleaning.** The log deletes files more than 14 days old, then deletes the oldest files while the folder holds more than 32 MB. It never deletes today's file. If today's file alone reaches the cap, logging stops for the day. Pruning runs at a server's first write each UTC day and after every 256 KB it writes. No scheduled job is needed.
- **D8. Never in the way.** The record is built and written after the reply has been handed back (`setImmediate`). Any failure is swallowed.
- **D9. One setting.** `"timing_log": false` in `probanda.json` turns it off from the next session.
- **D10. One reader.** `node source/lawyer/mcp/scripts/call-log-summary.mjs [--days N] [--json] [--dir D]` prints the slowest tools and reported phases, the calls in each session and the gaps between calls. A gap over 10 minutes counts as idle. `--json` gives a skill the same summary.

## Removed

- The stderr `[timings]` lines in `dispatch.ts` (`logTimings`, four call sites). The log now holds the same phases, with file names masked. The stderr lines carried the names of written documents into the host's server log.

## Considered options

- **The rules serve log.** Rejected: it lives in each matter's drafting database. Matter databases take no new tables, and the log must stay out of matter folders.
- **SQLite through the host Python, or a new Node SQLite dependency.** Rejected (D2).
- **A wrapper per tool or per tool list.** Rejected: several entry points and an `if` chain, against one handler (D1).
- **Logging tool arguments with redaction.** Rejected: redaction is a convention that can fail. Never passing the arguments cannot.

## Consequences

- The `bytes` field measures the reply text, which is a rough guide to the context a call costs.
- `build` is null in the unbundled test build. The bundled server stamps it.
- Time between calls includes the model's time, the client's time and the practitioner's time. Over a working week its distribution is the signal, not any single gap.
