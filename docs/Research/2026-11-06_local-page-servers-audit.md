# Local page servers: audit and consolidation plan

Date: 2026-11-06. Read-only audit, no code changed. Source audited: `source/` in this repository. CoClerk (`C:\Users\Brahm\Git\Coclerk`) is being deprecated (its CLAUDE.md), so it was read only to compare its older copy of the housekeeping server.

## Why this audit

A `/housekeeping` approval link failed to record Submit, and a re-served link worked. The question is which Probanda pages run their own `127.0.0.1` server and take input back, and whether that server logic is shared or has drifted.

## Summary

There are **three server designs** in the source, in **three files**, plus four thin credential pages built on one of them. Each plugin's bundle runs its own copy in its own process.

| Design | Code | Port | Link token | State |
|---|---|---|---|---|
| A. Housekeeping page server | `source/lawyer/mcp/src/housekeeping/server.ts` | random (port 0), lazy | 24 random bytes, base64url, in memory | in memory: lost when the process restarts |
| B. Credential page helper | `source/lawyer/mcp/src/key-request/page.ts` (`listen`, `page`, `readBody`, `escape`) | random (port 0), lazy | 24 random bytes, hex, in memory | in memory, one pending link per page module |
| C. Page API | `source/lawyer/mcp/src/page-api/server.ts` + `page-api/token.ts` | fixed 47615 (`page_api_port` in probanda.json), started at boot | HMAC-SHA256 of a per-device secret file and the target id | none in memory: any process on the device accepts the token, before or after a restart |

The likely cause of the failed Submit: design A keeps its token and its port in the process's memory. If the file-manager tool server restarts (a reconnect), the old page's port is closed or the token is unknown, and Submit fails with "Failed to fetch" or a 410 "out of date" reply. Design C was built to survive exactly that: its token is recomputed from a file on disk and the port is fixed, so a page keeps working across a restart and across sessions.

## Every served page that takes input back

### 1. Housekeeping approval page (design A)

- Tools: `housekeeping__serve_page` and `housekeeping__wait_approval` (`source/lawyer/mcp/src/file-manager-dispatch.ts:72`). Shipped in `plugins/file-manager/files-mcp/dist/file-manager-mcp.js`.
- Server: `housekeeping/server.ts:91` (`servePage`), listener at `:135` (`ensureListening`), `listen(0, "127.0.0.1")` at `:153`, router at `:161`, Approve at `:190`.
- Bind and port: `127.0.0.1`, port 0 (the OS picks a free port), started on the first serve. Listener and sockets are `unref`'d, so the server dies with the process. `keepAliveTimeout = 0` at `:148` (fix for issue #153).
- Link protection: URL path `/h/<token>/`, token minted at `:102`.
- Writing the submission: page script `housekeeping/templates/approval.js:180` POSTs JSON to `/h/<token>/approve`. The server checks the run id, a newer run, the proposal and each row, then creates `approval.json` exclusively (`"wx"`) and fsyncs it (`writeNewDurably`, `:227`). An existing approval is never overwritten.
- Stale links: each serve deletes every earlier token for that matter (`:101`). Approve is refused (409) if any newer run directory exists. An unknown token gets 410. A process restart loses every token.
- Waiting: `housekeeping/wait.ts:21` polls `approval.json` every 300 ms for up to 45 s, then returns `pending`; the skill re-issues it. Also returns `invalidated` and `corrupt`.
- Also in this file: `serveFiles` (`:112`), a read-only `/p/<token>/<name>` file server. **No caller in `source/`**: dead code, kept alive only by tests that call `closePageServer`.

### 2. Suggestion card (design C)

- Tools: `suggestion_card__build` and `suggestion_card__wait` (`source/lawyer/mcp/src/suggestions/tools.ts:80`, `:85`).
- Server: the page API, `page-api/server.ts:89` (`startPageApi`), started from `index.ts:52`; card routes at `:163`-`:166`, handler `cardClick` at `:308`, card page `cardPage` at `:255`.
- Bind and port: `127.0.0.1`, fixed port 47615. On `EADDRINUSE` it retries every 15 s, so a surviving session's process takes the port over when the owner exits (`:111`-`:123`).
- Link protection: the card file is written to disk (`suggestions/card.ts:502`) and its script POSTs to `http://127.0.0.1:47615/cards/<id>/<action>` with `pageApiCardToken` (HMAC of `"card\n" + id`, `page-api/token.ts:108`). A fallback link `GET /cards/<id>?token=` serves the card from the listener (`card-page.ts:383`). CORS answers `Origin: null` and Chrome's Private Network Access preflight.
- Writing the submission: `submitCard`, `dismissCard` and the rest write the suggestion store (`withStore`), not a separate file. Each click completes without an agent, so Submit works after the session has ended.
- Stale links: none by token. The card's own state decides (`effectiveState`, `card.ts:514`); a `sending` state older than 10 min reverts to open.
- Waiting: `waitForCard` (`card.ts:925`) polls the store every 500 ms for up to 45 s, writes a 60 s waiter heartbeat so the page knows an agent is listening, and returns `submitted`, `dismissed`, `mockup` or `pending`.

### 3. Other page API writes (design C)

Same listener, same token scheme, pages opened from `file://`:

- Loose Threads Defer / Undefer: `POST /seeds/<id>/defer|undefer` (`page-api/server.ts:167`), writes the drafting database. Token: HMAC of `db_path + proceeding_id`.
- Past suggestions Withdraw: `POST /suggestions/<id>/withdraw` (`:227`), writes the suggestion store.
- Suggestion mockup "Not like this": `POST /cards/<id>/reject` (`suggestions/mockup.ts:163`).
- Not input, same listener: `/focus` (Arguments page read), `/files/open` (open a file in its app), `/health`.

No session waits on these. The page shows the reply.

### 4. Credential pages (design B)

All four share `listen()` from `key-request/page.ts:34`. Each module holds one `pending` link and one `listening` promise of its own, so each runs a separate listener on its own random port.

| Page | Tool | Code | Route |
|---|---|---|---|
| Probanda's Cloud key | `cloud_key__configure_credential` | `key-request/page.ts:23`, `save-key.ts:15` | `/cloud-key/<hex>` |
| Key request | `key_request__submit` | `key-request/tools.ts:73` | `/key-request/<hex>` |
| Mail password | `mail__configure_credential` | `mail/page.ts:95`, `mail/tools.ts:219` | `/mail/<hex>` |
| TimeCamp token | timecamp `configure_credential` | `timecamp/page.ts:22`, `timecamp/tools.ts:163` | `/timecamp/<hex>` |

- Bind and port: `127.0.0.1`, port 0, lazy, `unref`'d.
- Link protection: 24 random bytes, hex, in the path.
- Writing the submission: an HTML form POST (urlencoded `secret`), handed to a `save` callback that checks the secret and stores it encrypted. The secret never reaches the chat.
- Stale links: a new serve replaces the one pending link. A successful save spends it. A refused save keeps it, so the practitioner can retry. A restart loses it.
- Waiting: none. The tool returns the link and tells the session to call a status tool when the practitioner says it is done.

### Not servers

- `pages__preview` and `pages__template` (`source/lawyer/mcp/src/pages/preview.ts`) only write or return files. Their pages post to the page API (design C) when they have buttons.
- `source/researcher/commons-mcp/build/key-page.js` is an untracked build leftover with no source file. The shipped `legal-commons-mcp.js` has no listener.

## Shared or copied

- Source level: design B is genuinely shared (four pages on one helper). Designs A and C are separate files that each re-implement the listener, `readBody`, JSON reply, security headers and error handler. Design C's header says outright that it differs from A.
- Runtime level: every bundle carries its own copy. Shipped bundles with a listener: `plugins/lawyer/mcp/dist/litigation-mcp.js` (page API, cloud key, key request), `plugins/lawyer/contacts-calendars-email-mcp/dist/...` (mail, plus page-API constants), `plugins/file-manager/files-mcp/dist/...` (housekeeping), `plugins/timekeeper/timecamp-mcp/dist/...` (TimeCamp). A fix in the source reaches each plugin only when that plugin is rebuilt.
- CoClerk's `plugins/litigation/mcp/src/housekeeping/server.ts` is the older copy of design A. It lacks the `keepAliveTimeout = 0` fix (#153) and uses the old firewall check. It is deprecated, not drift to fix.

## Drift

| Concern | A. Housekeeping | B. Credential pages | C. Page API |
|---|---|---|---|
| Survives a tool-server restart | no | no | yes |
| Port | random | random, one per page module | fixed 47615, takeover on exit |
| Token | random base64url, in memory | random hex, in memory | HMAC from on-disk secret |
| `keepAliveTimeout = 0` (#153) | yes | **no** | **no** |
| Body limit | 5 MB | 4 KB | 4 KB, card 256 KB |
| Content-Security-Policy | strict header | strict header, `form-action 'self'` | none on JSON; meta tag in the rendered page |
| CORS / Private Network Access | not needed (same origin) | not needed | yes (`Origin: null`) |
| 500 handler | JSON | HTML page | JSON with CORS |
| Stale link rule | newest serve per matter, newer run refused | newest serve per page | none by token; record state decides |
| Submission written to | `approval.json`, exclusive create + fsync | `save` callback (Credential Manager) | database or suggestion store |
| Session wait | `wait_approval` polls file, 300 ms / 45 s | none, status tool | `suggestion_card__wait` polls store, 500 ms / 45 s, heartbeat |
| `readBody`, `json`, headers | own copy | shared helper | own copy |

The two waits are the same loop written twice (poll, budget, `pending`), with different intervals.

## Recommended design

One module, `source/lawyer/mcp/src/local-page/` (name to settle), that every served page uses. It keeps what design C proved and drops what made design A fail:

1. **One listener per device on the fixed page-API port**, with the existing takeover retry. Every plugin bundle that serves a page starts it. Whichever process holds the port answers every route, so routes must be registered by every bundle that can serve them, or the holder must forward to the owner. Settle this in design (see step 2 below); it is the main open question.
2. **Stateless tokens**: HMAC over the per-device secret and a typed target (`"housekeeping\n" + matter + run`, `"card\n" + id`, `"credential\n" + kind + nonce`), compared in constant time. A link then survives a reconnect.
3. **Staleness from the record, never from memory**: the route decides from disk (newer run, card state, a spent nonce file), as housekeeping's newer-run check and the card's state already do.
4. **One write primitive** for submissions that become files: exclusive create, fsync, never overwrite (`writeNewDurably`).
5. **One wait primitive**: `waitFor(check, { pollMs, budgetMs })` returning the check's result or `pending`, used by both wait tools.
6. **One response layer**: `readBody(max)`, `json`, `html`, the security headers, CORS for `Origin: null`, `keepAliveTimeout = 0`, one 500 handler.
7. **Credential pages stay off the shared port's persistence if a secret must never outlive the session**: they can keep a one-use nonce, but use the same listener and helpers.

Removable now: `serveFiles` and its `/p/` route (no caller), and the untracked `commons-mcp/build/key-page.js`.

## Plan and the skills that fit

All of these are installed in this environment (checked 2026-11-06). There is no "standardize" skill.

1. **Design it twice** with `/software-design:codebase-design`. Its `DESIGN-IT-TWICE.md` and `DEEPENING.md` cover the module's interface and where the seam goes. Brief: this report, plus the open question in step 1 above (one holder answering all plugins' routes versus one port per plugin).
2. **Stress-test the chosen design** with `/design-review:grilling`: restart mid-wait, two sessions on one matter, the port held by a process from an older plugin version, a secret file deleted.
3. **Plan the migration** with `/planning:wayfinder` if it spans several sessions (four bundles, three designs). For a one-session job, skip it.
4. **Build test-first** with `/code-quality:tdd`. The first failing test reproduces today's bug: serve a housekeeping page, restart the server, POST Approve, expect 200. `/code-quality:coding-principles` applies while writing.
5. **Move callers one at a time** with `/trials:refactor` (behaviour-preserving moves): housekeeping first, because it has the live bug, then the waits, then the credential pages.
6. **Tidy** with `/simplify` once the move is done, to remove the leftover copies of `readBody` and the headers.
7. **Review** with `/code-quality:code-review` against this report as the spec.

## What this audit read

Read end to end: `housekeeping/server.ts` and `wait.ts`, `page-api/server.ts` and `token.ts`, `key-request/page.ts`, `mail/page.ts`, `timecamp/page.ts`, `key-request/save-key.ts`, and the CoClerk copy of `housekeeping/server.ts`. Read in part: `suggestions/card.ts` (build and wait), `key-request/tools.ts` (submit), `pages/preview.ts`, `housekeeping/templates/approval.js` (Submit), `suggestions/card-page.ts` (links). Searched: every `createServer`, `listen(`, and `127.0.0.1` in `source/` and the shipped bundles in `plugins/`.

Not verified: that the failed Submit was a restart. That is inferred from the in-memory design and Brahm's report of a reconnect. No test was run.
