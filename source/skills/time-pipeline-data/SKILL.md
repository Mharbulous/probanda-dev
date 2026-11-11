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
| Bulk apply | A consumer has more writes than is sensible one at a time, or needs to export stored values to a file |
| Namespaces | Deciding which namespace a key belongs to and which skill owns its writes |
| Conventions | Storing or reading values, addressing keys, or handling a path-resolution or `python_timeout` error |
| Anti-Patterns | Before reaching the database directly, treating a `get` miss as an error, or adding a namespace |

# Time-Pipeline DB routing layer

Helper skill — not user-invocable. The single gatekeeper for the time-pipeline
key-value store. Time-pipeline data lives in a **local SQLite database**
(`0. CASE DATA\_practice\time_pipeline.db`, alongside `practice.db`) and is
reached exclusively through the `time_pipeline__*` and `review_date__*` MCP tools,
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
| delete | `time_pipeline__delete` | `namespace`, `key`. Returns `{ ok: true, deleted: false }` when the key was already absent. |
| bulk apply | `time_pipeline__bulk_apply` | `namespace`, `path`, then `preview` or `expect`. Applies a whole file of writes in one transaction. See below. |
| export | `time_pipeline__export` | `namespace`, `path`, optional `prefix`. Writes every key under the prefix to a file of bulk-apply `set` lines. See Export, below. |

`set`, `delete`, `bulk_apply` and `export` refuse a key starting `review_date:` in namespace `item` with `protected_key`: only the `review_date__*` tools write those records, so a claim cannot be bypassed.

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
| `item` | the `review_date__*` tools, for `review_date:` keys | Timekeeping records, key `<kind>:<native id>`, with `kind` a field of the value. Today only reviewed dates |

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
