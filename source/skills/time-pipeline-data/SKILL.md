---
name: time-pipeline-data
user-invocable: false
description: Sole gatekeeper for the time-pipeline key-value store (timeline/timesort/tedraft/evidence/bill/item namespaces) and the per-date review records.
---

## Contents

| Section | Read when |
|---|---|
| Operation Routing | Always: choosing which `time_pipeline__*` tool serves a get, set, list, delete, bulk apply or export |
| Review dates | Claiming, renewing, judging, releasing, exporting or importing a reviewed date |
| Day records | Saving a day's evidence, staging a reviewer's blocks for a day, or reading a day back |
| Bulk apply | A consumer has more writes than is sensible one at a time, or needs to export stored values to a file |
| Namespaces | Deciding which namespace a key belongs to and which skill owns its writes |
| Conventions | Storing or reading values, addressing keys, or handling a path-resolution or `python_timeout` error |
| Anti-Patterns | Before reaching the database directly, treating a `get` miss as an error, or adding a namespace |

# Time-Pipeline DB routing layer

Helper skill — not user-invocable. The single gatekeeper for the time-pipeline
key-value store. Time-pipeline data lives in a **local SQLite database**
(`0. CASE DATA\_practice\time_pipeline.db`, alongside `practice.db`) and is
reached exclusively through the `time_pipeline__*`, `review_date__*` and `time_review__*` MCP tools,
served by this plugin's `timekeeping` server under whichever of
`mcp__plugin_billing_timekeeping__<name>` and
`mcp__remote-devices__plugin_billing_timekeeping__<name>` this host grants. This store
replaced the retired `cowork-db` Go binary (decision 2026-08-26, `Engineering/1.
Design/2026-08-26_time-pipeline-store-design.md`) — same key-value shape, same
`{namespace}:{key}` addressing, new storage underneath. All other skills
delegate here by invoking `time-pipeline-data` with an operation name; this
skill routes each operation to its tool. No consumer skill may reach the
database directly, embed a `kv_store` query, or assume its column names.

## Operation Routing

Determine the operation the consumer asked for and call the corresponding
`time_pipeline__*` tool. The MCP runtime handles all local database access —
the skill never sees SQL, schema, or the database path.

| Operation | Tool | Notes |
|---|---|---|
| get | `time_pipeline__get` | `namespace`, `key`. Returns `{ value, sha256 }`, `sha256` being the SHA-256 of the stored value; `{ value: null, sha256: null }` when the key is absent — never an error. |
| set | `time_pipeline__set` | `namespace`, `key`, `value`, and `expect_sha256` (the `sha256` the read returned) or `expect_absent: true` (for a key the read did not find). With either, a save against a value that changed since the read is refused with `stale_write` and writes nothing. In namespaces `bill` and `item` a save with neither is refused with `expectation_required`; elsewhere it overwrites any existing value. Returns `{ ok: true, sha256 }`. |
| list | `time_pipeline__list` | `namespace`, optional `prefix`. Prefix scan within one namespace only, sorted by key, each row with its `sha256`; omit `prefix` to list the whole namespace. |
| delete | `time_pipeline__delete` | `namespace`, `key`, and `expect_sha256` (the `sha256` the read returned). With it, a key whose value changed since the read, or is gone, is refused with `stale_write` and nothing is deleted. In namespaces `bill` and `item` a delete without it is refused with `expectation_required`. Elsewhere, without it, returns `{ ok: true, deleted: false }` when the key was already absent. |
| bulk apply | `time_pipeline__bulk_apply` | `namespace`, `path`, then `preview` or `expect`. Applies a whole file of writes in one transaction. See below. |
| export | `time_pipeline__export` | `namespace`, `path`, optional `prefix`. Writes every key under the prefix to a file of bulk-apply `set` lines. See Export, below. |

`set`, `delete`, `bulk_apply` and `export` refuse a key starting `review_date:`, `day_evidence:` or `block:` in namespace `item` with `protected_key`, even when the call names what it read. Only the `review_date__*` tools write the first, so a claim cannot be bypassed, and only the `time_review__*` tools write the others, so a reviewer cannot save a block with its own flags. `export` is refused too: `time_review__read_day` returns a day's evidence and blocks, and a file of them would leave the store by a route that skips it. A `bulk_apply` in `bill` or `item` already names what it read, because it is called first with `preview` and then with the `expect` that preview returned; one with neither is refused.

On `stale_write`: call `get` for that key, make the same change to the value it returns, and save once more with the new `sha256`.

## Review dates

One record per reviewed date, key `review_date:<YYYY-MM-DD>` in namespace `item`. Its status is derived, never stored: judged, in progress (a live claim) or not started. A claim lasts 60 minutes. The `holder` is the bill id, or `timecamping:<UTC stamp>` for a run with no bill.

| Operation | Tool | Notes |
|---|---|---|
| claim | `review_date__claim` | `date`, `holder`. Returns `claimed` with `token` and `expires_at`, or `judged` with `judged_at` and `judged_by`, or `held` with `holder` and `expires_at`. The token is given only here. |
| renew | `review_date__renew` | `date`, `token`. A new `expires_at` 60 minutes from now, or `claim_lost`. |
| judge | `review_date__judge` | `date`, `token`. `judged_at`, with `judged_by` the holder. Works after the claim lapsed if no other run claimed the date since. Or `claim_lost`. |
| release | `review_date__release` | `date`, `token`. Released, not judged. Or `claim_lost`. |
| status | `review_date__status` | `dates`. Per date: `not_started`, `in_progress` (holder, expires_at) or `judged` (judged_at, judged_by). |
| export | `review_date__export` | `from`, `to`, `out_path`. One line per judged date, `{"date", "judged_at"}`, the file `tie_out.py` reads. Returns the path, the count and the file's SHA-256. |
| import | `review_date__import_file` | `path`, `judged_by`, `dry_run`. Reads a `judged-dates.jsonl` and marks each date not yet judged, reporting the dates added and skipped. `dry_run` writes nothing. The file is never changed. |

## Day records

A day's evidence and its reviewed blocks are two kinds of record in namespace `item`, written only by the `time_review__*` tools. Each tool's `date` is `YYYY-MM-DD`.

| Operation | Tool | Notes |
|---|---|---|
| save evidence | `time_review__save_evidence` | `date`, `sources`, `rows`. Saves the `day_evidence` record whole, replacing any earlier save. `sources` is a list of `{source, status}`: what the gather step got from each of the gate's seven sources, `status` being the fetch status filed for it. `rows` are the evidence rows, each naming its `source`, which `sources` must list. Returns `saved` with `complete` and `short` (the sources with no outcome), or `judged` when the date is judged, which writes nothing. |
| stage day | `time_review__stage_day` | `date`, `token` (from `review_date__claim`), `blocks`. Returns `staged` with each block's `id`, `state` and `flags`, or a refusal that writes nothing: `judged`, `held` (another run holds the claim), `claim_lost` (the token holds none), `evidence_missing` (no `day_evidence` saved) or `evidence_short` (a gate source has no outcome; `short` names them). Staging again before the date is judged replaces its blocks. |
| read day | `time_review__read_day` | `date`. `{date, clear, evidence, blocks}`: whether the day is clear (judged, no flagged block), the saved `day_evidence` record or null, and the staged blocks in order. A block a click has acted on also holds `review` (`act`, `by`, `at`, and `reason` for a write-off; `before` for a correction) and, after an approval or correction, `timecamp` (`status`, `message`, `at`). |
| serve page | `time_review__serve_page` | `screens_dir` (optional): the absolute path of the `syncopaid-screens` folder. Serves the review page built from the stored blocks, evidence and `capture_reading` records, with Approve, Correct and Write off on every card, and returns `{url, screenshots, blocks}`. Reads no image until the browser asks for one. Drops earlier pages and unread clicks. |
| wait click | `time_review__wait_click` | Returns `clicked` with `act`, `block`, `blocks` and `clicked_at` for the oldest unread click (a `page_click:` record in `item`, consumed on read), or `pending` after about 45 seconds. An `approve`, `correct`, `write_off`, `split`, `merge` or `undo` click has already been saved to its block or blocks by the page. For the last three, `blocks` names the blocks the click made or restored. |
| redraft | `time_review__redraft` | `block`, `matter`, `description`. Saves the redrafted matter and description of a half made by a split and ends its pending redraft. Refused for a block with no redraft waiting. The half stays flagged. |
| mark issued | `time_review__mark_issued` | `blocks` (ids), `invoice` (the number). Marks blocks as on an issued invoice. From then on Unmerge and Unsplit, and a further split or merge, are refused for them and for the blocks they were made from. Marking twice changes nothing. |
| record TimeCamp | `time_review__record_timecamp` | `block`, `status` (`saved`, `unchanged`, `staff_left_alone` or `error`) and `message` (required with `error`). Saves how the write of an approved or corrected block to TimeCamp went, shown on its card. Refused for a block no click has approved or corrected. Cannot approve a block or change its state or fields. |

The gate's seven sources are the table names `timecamp_time_entries`, `timecamp_computer_activities`, `syncopaid_captures`, `telus_calls`, `gcal_events`, `icloud_events` and `sent_mail`. A source has an outcome when its status is `fetched`, `empty` or `skipped`, as in the assembly gate query.

A `day_evidence` record: key `day_evidence:<date>`, value `{"kind", "date", "saved_at", "sources": [{source, status}], "rows": [{source, ...}]}`. A `block` record: key `block:<date>:<nnn>`, value `{"kind", "id", "date", "start", "end", "matter", "description", "matter_basis", "bill_basis": [], "flags": [], "state", "evidence": [{source, ref}], "links": [{role, block}], "staged_at"}`. `links` is empty until a split or merge fills it: a half made by a split carries `{"role": "split_from", "block": <original>}`, and each original joined by a merge carries `{"role": "merged_into", "block": <new block>}`. The original's `state` is then `split` or `merged`, and it is kept. A block may also hold `redraft` (`status` pending or done, for a split half) and `issued` (`invoice_number`, `at`).

In a block, `start` and `end` are `HH:MM` local time. `matter` is the matter number as the evidence and the practice records give it, or `unknown` where the evidence names none (state `no_evidence`). A block's `evidence` entry `{source, ref}` names a row: `ref` is the row's position in the day's saved `rows`, counted from 0 and written as text. A screen capture the rows do not hold is cited by its capture id under `syncopaid_captures`. Stage personal and non-billable stretches as blocks too, so the day is whole.

The reviewer states each block's `matter_basis` (one value) and `bill_basis` (a list, empty when nothing is in doubt). Code sets `flags` and `state` from them, and the reviewer cannot pass either. `state` is `auto_assigned` only when `flags` is empty. `flags` lists every doubtful value, prefixed `matter:` or `bill:`.

| `matter_basis` | Meaning | Flagged |
|---|---|---|
| `evidence_names_matter` | The direct evidence's content names the matter | no |
| `presumption` | An approved standing presumption covers the identifier-to-matter leap, and no other approved presumption also matches | no |
| `presumption_covers_conflict` | A conflict between sources that an approved presumption covers | no |
| `identifier_leap_uncovered` | An identifier-to-matter leap no presumption covers | yes |
| `indirect_only` | Only indirect evidence, such as a calendar entry or TimeCamp's own label | yes |
| `conflict_uncovered` | Sources conflict and no presumption covers it | yes |
| `no_evidence` | No data from any source | yes |

Every `bill_basis` value flags the block: `description_inferred` (the description rests on inference), `duration_unbounded` (the evidence cannot bound the duration), `no_evidence` (a line with no evidence), `staff_inferred` (a staff line described by inference), `proposed_writeoff` (a non-billable marker matched inside the entry), `estimate` (an estimate for unlogged time) and `late_line` (a line from a date the last bill missed or under-billed).

## Bulk apply

`bulk_apply` exists because the four single-key operations each start their own
process and commit on their own. An import of tens of thousands of rows can be
neither an agent loop of that many tool calls nor one call whose arguments
carry the whole payload. Instead the caller writes a JSONL file (one JSON
object per line), and the runtime reads that file itself and applies every line
in a single transaction.

Reach for it when a consumer has more writes than it would be sensible to make
one at a time. For a handful of keys, use `set` and `delete`.

Four line types, applied in file order:

| Line | Effect |
|---|---|
| `{"op":"set","key":...,"value":...}` | Same as `set`. `value` is a string, stored verbatim. |
| `{"op":"delete","key":...}` | Same as `delete`. |
| `{"op":"delete_prefix","prefix":...}` | Removes every key in the namespace starting with `prefix`, matched literally. |
| `{"op":"merge","key":...,"add":[...],"drop_prefix":...}` | Reads the value as a JSON array of strings, drops every element starting with `drop_prefix`, appends the elements of `add` that are not already there, and deletes the key if nothing is left. |

`merge` is for a key several consumers share, such as an index holding ids from
more than one source. Overwriting such a key with `set` would silently discard
another consumer's entries. `merge` lets a caller replace only its own.

Failures are hard and nothing partial is written: a missing file, a line that
is not valid JSON, an unrecognised `op`, or a `merge` target that does not hold
a JSON array of strings aborts the call before the commit and names the line
number.

Call it twice. `preview: true` does the work, rolls it back and returns `{ lines, sets, deletes, merges, deleted_by_prefix, added, replaced, removed, file_sha256, applied: false }`. The second call passes `expect: { added, replaced, removed, file_sha256 }` from that reply, and commits only if they still match the file and the store. On a mismatch nothing is written: preview again.

**Export.** `export` is bulk apply's read twin. It writes every `(key, value)` in the namespace whose key starts with `prefix` (matched literally; omit it for the whole namespace) to the JSONL file at `path`, an absolute path on this machine, sorted by key, one `{"op":"set","key":...,"value":...}` line per key. It creates the file's parent directory, overwrites any file already there, and returns `{ items, path }`. The file re-applies with `bulk_apply` as it stands. Use it when a consumer needs many stored values in a file rather than in its context. The file holds every value verbatim, so never export a prefix that takes in `config:` keys (a store set up before the timecamp connector may still hold a TimeCamp token there) to a shared or synced location.

## Namespaces

Six namespaces exist today, each owned by exactly one consumer skill for
writes (any skill may `get`/`list` another skill's namespace when its own
workflow legitimately needs to read it — e.g. time-sorting reads `timeline`):

| Namespace | Owner (writes) | Purpose |
|---|---|---|
| `timeline` | build-timeline | Raw source-attributed activities and events |
| `timesort` | time-sorting | Classified day objects, project tree, corrections |
| `tedraft` | time-entry-drafting | Draft entries, UTBMS metadata, description patterns |
| `evidence` | timecamping-data, whose table names each family's writer | Billing evidence with no table of its own |
| `bill` | bill | A bill in progress: its state and each step's completion |
| `item` | the `review_date__*` tools, for `review_date:` keys, and the `time_review__*` tools, for `day_evidence:` and `block:` keys | Timekeeping records, key `<kind>:<native id>`, with `kind` a field of the value. Kinds today: `review_date` (the `review_date__*` tools), `day_evidence` and `block` (Day records, above), `capture_reading`, `candidate_date` and `candidate_coverage` (below), and `page_click` (a click on the review page, key `page_click:<time>:<id>`, written by the page listener and consumed by `time_review__wait_click`; no skill writes it) |

A `capture_reading` record is a SyncoPaid capture's reading, saved so the capture is never sent to the screenshot reader twice. Key `capture_reading:<capture id>` in `item`, value `{"kind", "capture_id", "read_at", "reading": {"on_screen", "identifiers", "unchanged", "unreadable"}, "answers": []}`, `reading` as the reader reported it. `/timecamping` Step 5 and `/triage-billing-dates` Phase 2 look it up with `get`, save it with `set` and `expect_absent: true` (a second save is refused with `stale_write`), and append a later answer to `answers` with `set` and `expect_sha256`. The generic tools write it: no tool of its own.

A `candidate_date` record is one date on a matter's triage list, and a `candidate_coverage` record is that matter's one summary of what the list has covered. Both are written by `/triage-billing-dates` with the generic tools, and every save in `item` names what it read (`expect_absent` for a new key, `expect_sha256` for a change). Key `candidate_date:<matter>:<first date>`, value `{"kind", "matter", "date", "date_to" (a range only), "strength", "who", "flags": [], "found_at", "evidence": [evidence-namespace keys], "summary"}`. Key `candidate_coverage:<matter>`, value `{"kind", "matter", "covered_through", "period_start", "write_offs": [{"date", "reason"}], "nothing_found": [], "open_leads": [{"lead", "source"}]}`. A resume reads `covered_through` and `open_leads`; the `candidate_list.py` and `resume_plan.py` scripts of `/triage-billing-dates` generate the files and check that every cited evidence key is saved. Rows hold metadata only.

`bill` and `issue-invoice` call the `time_pipeline__*` tools directly for `bill` instead of invoking this skill (ruled on #250). They use `set`, `get` and `list` only.

## Conventions

- Frontmatter stays `name: time-pipeline-data`, `user-invocable: false`. This
  skill is a router: it holds no schema beyond the namespace/key/value shape
  above, and no SQL.
- `value` is always a **string**. A caller storing structured data
  `JSON.stringify`s it before calling `set`, and `JSON.parse`s the string
  `get`/`list` returns. The store itself never parses or validates JSON — it
  is stored and returned verbatim, byte-for-byte. The one exception is
  `bulk_apply`'s `merge` line, which by definition reads its target as a JSON
  array of strings and fails if it is not one.
- The `{namespace}:{key}` addressing scheme includes hand-rolled index keys
  such as `index:activity:by-date:{date}` or `source:{source}:ranges` — those
  are ordinary `key` values inside a namespace, not a distinct mechanism.
- `list`'s `prefix` matches literally: a `_` or `%` inside a key (e.g.
  `source:timecamp_%:ranges`, if a key ever contains one) is matched as a
  literal character, not a SQL wildcard. Callers never need to escape
  anything themselves.
- The `time_pipeline__*` tools are served by the `timekeeping` server with a
  **local SQLite backend** — no sign-in, unlock, or session gate, the same as
  `practice_data__*`.
- If a tool returns a path-resolution error, the runtime could not locate
  `time_pipeline.db`: confirm `case_data_root` is set in
  `AppData\Roaming\Probanda\probanda.json` (or the file `COCLERK_CONFIG_PATH`
  names; the same config practice-data resolves against, see its SKILL.md's
  Configuration section), or the
  `COCLERK_TIME_PIPELINE_DB_PATH` test override.
- A `set`, `delete` or `bulk_apply` that fails with a `python_timeout` error
  may already have committed: each call is one transaction (a whole
  `bulk_apply` file included), so it landed whole or not at all. Read the
  affected keys back with `get` or `list` and retry only if the write is
  absent.

## Anti-Patterns

- **Embedding a `kv_store` query or reaching the database directly from
  another skill.** All time-pipeline access goes through the
  `time_pipeline__*` tools via this skill — never resolve the DB path or open
  a connection from a consumer.
- **Treating a `get` miss as an error.** An absent key returns
  `{ value: null }`; that is the normal "not yet fetched/sorted/drafted"
  state, not a failure to handle specially.
- **Inventing a namespace outside the six above** without updating this
  file. A new namespace is a routing decision, not something a consumer
  skill decides unilaterally.
- **Reading another skill's namespace to derive facts that skill already
  computes.** For example, deriving "is this day sorted" by hand from
  `timesort` keys duplicates logic time-sorting owns; prefer a read that
  skill exposes (e.g. its `coverage` query) over re-deriving from raw keys.
