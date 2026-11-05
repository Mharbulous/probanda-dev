---
name: time-pipeline-data
user-invocable: false
description: Sole gatekeeper for the time-pipeline key-value store (timeline/timesort/tedraft/evidence/bill namespaces).
---

## Contents

| Section | Read when |
|---|---|
| Operation Routing | Always: choosing which `time_pipeline__*` tool serves a get, set, list, delete, bulk apply or export |
| Bulk apply | A consumer has more writes than is sensible one at a time, or needs to export stored values to a file |
| Namespaces | Deciding which namespace a key belongs to and which skill owns its writes |
| Conventions | Storing or reading values, addressing keys, or handling a path-resolution or `python_timeout` error |
| Anti-Patterns | Before reaching the database directly, treating a `get` miss as an error, or adding a namespace |

# Time-Pipeline DB routing layer

Helper skill — not user-invocable. The single gatekeeper for the time-pipeline
key-value store. Time-pipeline data lives in a **local SQLite database**
(`0. CASE DATA\_practice\time_pipeline.db`, alongside `practice.db`) and is
reached exclusively through the `time_pipeline__*` MCP tools. This store
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
| get | `time_pipeline__get` | `namespace`, `key`. Returns `{ value: null }` when the key is absent — never an error. |
| set | `time_pipeline__set` | `namespace`, `key`, `value`. Overwrites any existing value at that key. |
| list | `time_pipeline__list` | `namespace`, optional `prefix`. Prefix scan within one namespace only, sorted by key; omit `prefix` to list the whole namespace. |
| delete | `time_pipeline__delete` | `namespace`, `key`. Returns `{ ok: true, deleted: false }` when the key was already absent. |
| bulk apply | `time_pipeline__bulk_apply` | `namespace`, `path`, then `preview` or `expect`. Applies a whole file of writes in one transaction. See below. |
| export | `time_pipeline__export` | `namespace`, `path`, optional `prefix`. Writes every key under the prefix to a file of bulk-apply `set` lines. See Export, below. |

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

Call it twice. `preview: true` does the work, rolls it back and returns `{ lines, sets, deletes, merges, deleted_by_prefix, added, replaced, removed, file_sha256, applied: false }`. The second call passes `expect: { added, replaced, removed, file_sha256 }` from that reply, and commits only if they still match the file and the store. On a mismatch nothing is written: preview again. A second call that replaces or removes anything waits for the practitioner's pasted approval and cannot run from a subagent. One that only adds does not wait.

**Export.** `export` is bulk apply's read twin. It writes every `(key, value)` in the namespace whose key starts with `prefix` (matched literally; omit it for the whole namespace) to the JSONL file at `path`, an absolute path on this machine, sorted by key, one `{"op":"set","key":...,"value":...}` line per key. It creates the file's parent directory, overwrites any file already there, and returns `{ items, path }`. The file re-applies with `bulk_apply` as it stands. Use it when a consumer needs many stored values in a file rather than in its context. The file holds every value verbatim, so never export a prefix that takes in `config:` keys (a store set up before the timecamp connector may still hold a TimeCamp token there) to a shared or synced location.

## Namespaces

Five namespaces exist today, each owned by exactly one consumer skill for
writes (any skill may `get`/`list` another skill's namespace when its own
workflow legitimately needs to read it — e.g. time-sorting reads `timeline`):

| Namespace | Owner (writes) | Purpose |
|---|---|---|
| `timeline` | build-timeline | Raw source-attributed activities and events |
| `timesort` | time-sorting | Classified day objects, project tree, corrections |
| `tedraft` | time-entry-drafting | Draft entries, UTBMS metadata, description patterns |
| `evidence` | timecamping-data, whose table names each family's writer | Billing evidence with no table of its own |
| `bill` | bill-client | A bill in progress: its state and each step's completion |

`bill-client` and `issue-invoice` ship in `lawyer`, which names nothing in this plugin, so they call the `time_pipeline__*` tools directly for `bill` instead of invoking this skill. They use `set`, `get` and `list` only.

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
- The `time_pipeline__*` tools are served by the plugin MCP runtime with a
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
- **Inventing a namespace outside the five above** without updating this
  file. A new namespace is a routing decision, not something a consumer
  skill decides unilaterally.
- **Reading another skill's namespace to derive facts that skill already
  computes.** For example, deriving "is this day sorted" by hand from
  `timesort` keys duplicates logic time-sorting owns; prefer a read that
  skill exposes (e.g. its `coverage` query) over re-deriving from raw keys.
