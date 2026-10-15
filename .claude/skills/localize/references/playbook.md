# localize-helper playbook

Read by the `localize-helper` agent over `skill_source__read`, path `localize/references/playbook.md`. The record contract, grammar, index shapes, resolve and sidecar are `shared/knowledge-tree.md`. This file is the tool sequence per operation and how to handle each result.

Every tool below is named without its prefix. Call it under whichever of `mcp__plugin_practice_data__<name>` and `mcp__remote-devices__plugin_practice_data__<name>` this host grants.

## 1. Rules for every run

- **Dispatch.** One JSON object: `operation`, `run` (`repo` or `matter`), the calling skill, country, jurisdiction, venue as named, kind as named, recipient, `matter` (the live matter's file number, such as `1234.L####`, never its style of cause or a party's name; or `repo-run`), and any re-call arguments (`alias_of`, `new_venue`, `new_kind`, `allow_host`, `saved_copy`). A `/draft` `create` may carry `practitioner_layout` instead, with or without `saved_copy` (section 3a).
- **Paths.** A knowledge path starts with the calling skill: `draft\CAN\BC\<Venue>\...`. In a repo run the returned path is skills-tree-relative: the skill's shipped root (`shared/knowledge-tree.md` §2) followed by the same tail, as `draft\references\CAN\BC\<Venue>\...`.
- **`matter` argument.** Every `knowledge__write` and `knowledge__retire` call carries the dispatch's live matter as `matter`. A repo run makes neither call. If one is made anyway and returns `repo_session`, that is expected: never retry it.
- **Built-in `Read`.** Only on a file under `_practice\knowledge\_fetched\` or `_practice\knowledge\_inbox\`: a PDF a fetch saved, or the practitioner's saved copy named in `saved_copy`. Nothing else, however reachable.
- **Never state law.** Record verbatim passages and where they are published. Never paraphrase a rule into a requirement it does not state, never assess what a rule means, never infer a period or a date.
- **Never write status into a file.** Status lives only in the sidecar, written by `confirm` and `correct`.
- **Hashes.** Record a sha256 only as a tool result gave it. Never compute or invent one. A practitioner's saved PDF gets its hash from `knowledge__write` (section 3, step 4), and a repo run records none (section 4, step 3).

## 2. Result handling

| Result | Where it comes from | What to do |
|---|---|---|
| `result: "resolved"` | `knowledge__list` with `resolve`, which returns its outcome in `result`: `resolved`, `near_miss`, `not_found` or `ambiguous` | Use the resolved `code` or file. |
| `result: "near_miss"`, `candidates: [{code, name, rule}]` | `knowledge__list` | Return `ambiguous` with the `candidates` as given. Never guess. |
| `result: "ambiguous"`, `alias_split: [{code, name, via}]` (`via`: `code`, `name`, `alias` or `not_venue`) | `knowledge__list` | Return `ambiguous` with the codes. Never guess. |
| `result: "not_found"` | `knowledge__list` | A new venue or kind. Go on only when the dispatch carries `new_venue: true` or `new_kind: true`. Otherwise return `ambiguous` with no candidates, so the caller asks. |
| `{refused: "host_not_allowed", host, url, redirect_from?, hosts_fetched}` | `sources__fetch` (a result object, not an error) | Return `refused`, reason `host_not_allowed`, with `host`, `page_url`, `category` (the kind of official source the page is: `venue`, `statute` or `regulator`) and any `redirect_from`. On a matter-run re-call whose `allow_host` equals the host you are about to fetch or were refused on, write the entry, then fetch once more: `knowledge__write` with `operation: "create"`, `path: "_hosts.json"` and `row: {host, category, page_url}`. `status: "exists"` counts as written. The runtime re-reads the file on the fetch. An `allow_host` naming any other host writes nothing. A repo run writes nothing either: a host joins the shipped list only through a reviewed commit. A second refusal is returned the same way. |
| `{refused: "fetch_failed", host, url, detail, status?, hosts_fetched}` | `sources__fetch` | Return `refused`, reason `fetch_failed`, with `host`, `page_url` and `detail` as given. |
| error `no_match` | `sources__fetch` with `match` | The passage is not on the page. Fetch once more with a narrower `match` copied from the page. If it still misses, write nothing for that document and return `refused`, reason `excerpt_mismatch`, with the `rule_ref`s. Never drop an item silently. |
| `truncated: true` | `sources__fetch` without `match` | Fetch again with `match` naming the passages you need. |
| error `excerpt_mismatch` | `knowledge__write` | Fetch the page again with `match` on the named `rule_ref`s' passages, copy each passage verbatim from the result, and write once more. A second failure returns `refused`, reason `excerpt_mismatch`, with the `rule_ref`s. |
| error `memo_expired` | `knowledge__write` | Fetch the named URLs again and write once more. A second failure returns `refused`, reason `memo_expired`, with the URLs. |
| error `stale_body` | `knowledge__write` on a refresh overwrite | Return `refused`, reason `stale_body`. |
| error `exists` | `knowledge__write` `create` on a source record or on `venue.md` | An earlier run of this create wrote it, or a sibling run did. It counts as written; go on to the next file. |
| error `exists` | `knowledge__write` `create` on the requested document | Another run created it. `knowledge__read` it and return that path with status `exists`. |
| error `not_found` | `knowledge__retire`, a second time | Counts as done. |
| error `person_unset`, `not_a_lawyer`, `not_active`, `rule_ref_not_found` or `not_correctable` | `knowledge__write` confirm or correct | Return `refused` with the runtime's code and message. For the first three the caller asks once and calls again. |
| error `shipped_path` | `knowledge__write` | A shipped file is never written from a matter session. Return `refused`, reason `shipped_path`: the fix is a repo-session refresh, then repackage and reinstall. |
| any error not named above, on a `create` at section 3, step 3 or 4, after an earlier file of the same run landed | `knowledge__write`, matter run | Stop. Return `refused` with the tool's code and message, and on the detail of every requested document `written`, the knowledge path of every file this run wrote, and `saved_copy`, the source record's `saved_copy` result (`moved`, `to`) where one was written. No index row has been written, so nothing resolves to them. A re-call of `create` with the same arguments completes the set: section 3, step 3 skips each source record that already exists, and `exists` on the other files counts as written. Never retire them: a retire deletes a `_fetched\` PDF no live file cites, which may be the practitioner's saved copy. |
| any error not named above, on a `create` at section 3, step 5 or 6 | `knowledge__write`, matter run | Stop. Return `refused` with the tool's code and message, and `written` on the detail of every requested document. The venue may already resolve without its kinds row. A re-call of `create` with the same arguments then resolves the venue at step 1, so it is not new, and the kind as `not_found`, so the run writes the documents (`exists` counts as written) and then the missing kinds row. |
| no admitted source | the dispatch names no source of the kinds `shared/knowledge-tree.md` §8 admits, and none is reachable by fetch | Return `no_official_source`. |

Any other tool error: return `refused` with the tool's code and message. Never work around it.

## 3. `create`, matter run

1. **Resolve.** `knowledge__list` with `dir` the jurisdiction folder and `resolve` the venue as named. Then `knowledge__list` with `dir` that venue's `Documents` folder and `resolve` the kind as named, with `recipient` under `_NoVenue`. A `not_venues` hit resolves to `_NoVenue`. If the kind's file already exists in either layer, return `exists` with its path. That is decided by the resolve outcome only, `resolved` to a file, never by reading the expected path. When the venue resolved `not_found`, an `index_missing` error on the kind resolve (a new venue has no kinds index in either layer) is read as `not_found`.
2. **Re-call answers.** With `alias_of`, write one row with `knowledge__write` to `venues.local.json` (or `kinds.local.json`): a partial row on the named venue or kind, keyed by `code` in `venues.local.json` and by `file` in `kinds.local.json`, with the name as given as an alias, `source: practitioner`, `ref` the matter. With `alias_of: "_NoVenue"`, the row is a `not_venues` row (`shared/knowledge-tree.md` §4). Never record an alias without `alias_of`.
3. **Fetch.** First `knowledge__read` each source record the run would write. A record that already exists counts as written: skip its fetch, its `Read` of the saved copy and its write, and take the dependent files' `rule_ref`s from that read. Then `sources__fetch` on each remaining source page, with `match` naming the passages the documents need. A PDF source: `sources__fetch` with `save: true`, then `Read` the `saved_path` to transcribe, marking each item `checked_by: file_sha256` with its page number and the PDF-transcription `fetch_note`. With `saved_copy`, `Read` that file instead and use the saved-by-practitioner `fetch_note`. Its items carry `checked_by: file_sha256`, and `sources__check` reports them `present: null`. Never compute a hash: `knowledge__write` records it (step 4).
4. **Write.** Each `knowledge__write` `operation: "create"`: source records under `Sources\` first, then `venue.md` for a new venue (declaring `slot:` where a venue part matches no projection), then each requested document (a `/draft` run: the type file with its layout block). Content is the record contract, `shared/knowledge-tree.md` §8: a source record carries `items:`; `venue.md` and a type file carry `sources:` and cite the records' `rule_ref`s in the layout block and in prose, never an `items:` copy of them. The runtime stamps `learned_by`, `matter`, `plugin_version` and `shipped_from`. It stamps `matter` as the practice-data matter's own number (`L####`), never the dispatch's string, and refuses with `matter_unknown` when no single matter has that number. The source record transcribed from a saved copy is written with `saved_copy` set to that file's knowledge path (`_inbox/<name>`): a PDF gets its `pdf_sha256` stamped and is moved into `_fetched\` once the record is written, and any other file stays in `_inbox\` unhashed. A result `saved_copy` with `moved: false` and an `error` means the record was written but the file did not move: say so in the return.
5. **Index rows last.** Only once every file of the run is written: for a new venue, one `knowledge__write` `row` to `venues.local.json`. For a new kind, one `row` to `kinds.local.json` in its `Documents` folder, its `file` as `shared/knowledge-tree.md` §4 (Kinds index) defines it. The runtime stamps each row's `plugin_version` and `shipped_from` and refuses a row that carries either. A row is the step that makes the venue or kind resolvable, so a run that fails earlier leaves nothing that resolves.
6. **Periods.** Each period set by a rule the documents cite: `knowledge__write` to `docket-clerk\...`. Leave it out of the return entirely.
7. **Return** (section 7): status and relative path per requested document. Never file content.

## 3a. `create` with a practitioner layout, matter run

The dispatch carries `practitioner_layout: {title, folder_code, parts}`, the layout of a Writing the practitioner has sent, and, when that Writing copies a form the venue publishes, `saved_copy` naming the copy `/localize` staged under `_inbox\`. The layout is the practitioner's own: nothing is fetched and no venue source is learned. A repo run refuses it without a tool call. `<stem>` below is the `title` in lower case, each run of characters other than letters and digits made one hyphen.

1. **Resolve.** As section 3, step 1, the kind as named being the `title`. A kind that resolves returns `exists` with its path. A `near_miss` or `ambiguous` result returns `ambiguous` as section 2 says, and a re-call with `new_kind: true` goes on. A `not_found` goes on, because a practitioner layout is a new kind.
2. **Check the parts.** Every part has the members `shared/declared-layout.md` section 3 lists, and its `source` is in section 4's vocabulary: a projection, `slot:<name>`, or `literal` with its `text`. A `caption` part under `_NoVenue` is refused too. Return `refused`, reason `invalid_layout`, naming each part that fails by its index, and write nothing. Never change or drop a part to make it pass.
3. **Check each literal against the saved form**, with `saved_copy` only. `Read` the staged copy and find each `literal` part's `text` in it, word for word. A part the form does not hold returns `refused`, reason `excerpt_mismatch`, naming each such part by its index, and nothing is written. Never edit a part's text to make it match.
4. **Write the source record**, with `saved_copy` only: `knowledge__write` `operation: "create"` on `Sources\<stem>.md` in the venue's folder, with `saved_copy` the staged path. Its front matter is the record contract's (`shared/knowledge-tree.md` §8): `page_url` from `saved_copy`, `accessed`, `fetch_note: "saved by practitioner; form copy for a practitioner layout"`, and one item per `literal` part, `rule_ref` `<stem>-part-<n>` (`n` the part's index), `passage` the part's `text` verbatim, `checked_by: file_sha256`, and its page number when the copy is a PDF. An `exists` error counts as written, as section 2 says.
5. **Write the type file**: `knowledge__write` `operation: "create"` on `Documents\<stem>.md`. Its front matter carries `sources:` naming the record by its path relative to the type file, when one was written. Its layout block is `renderer: "general"`; `needs_forum_parts` true at a venue and false under `_NoVenue`; `folder_code` and `title` as given; `exhibit_numbering: "writing"`; `goal_criteria` at a venue those of its stock `unstructured` type (`knowledge__read` on `Documents\unstructured.md`), and under `_NoVenue` `["noting-up", "recipients", "open-items", "counsel-review"]`; and `parts` exactly as given, each `literal` part checked at step 3 carrying its record item's `rule_ref`. Its prose is one line: the layout was recorded from a Writing the practitioner sent, and the source record holds the form it copies. The runtime stamps `learned_by` and `matter`.
6. **Index row last**, as section 3, step 5: one `row` to `kinds.local.json` in the venue's `Documents` folder, `file` the stem, `name` the `title`, `aliases` empty (the `title` already resolves as the name, and an alias equal to it is refused), and under `_NoVenue` the dispatch's `recipient`.
7. **Return** (section 7): status `created` and the type file's relative path. Never file content.

## 4. `create`, repo run

1. **Resolve.** As in section 3, step 1. The resolve and the `exists` check read the installed tree, not the checkout: `knowledge__list` and `knowledge__read` resolve the shipped layer install-first, so a candidate committed but not yet repackaged is invisible here.
2. **Prove every passage.** `sources__fetch` with `match` for each item's passage. Zero matched blocks (`no_match`) is an error and is handled as section 2 says: a passage still unmatched after one narrower fetch blocks the candidate. Read the currency marker from the same fetched text. A PDF source: `sources__fetch` with `save: true` (it lands in the firm overlay's `_fetched\`), then `Read` the `saved_path`, marking items as in section 3, step 3.
3. **Compose** each candidate in full: a header of `learned_by: agent`, `matter: repo-run`, `accessed`, `reviewed_by`, `reviewed_on`, and no `plugin_version` or `shipped_from`; source records with their `items:`, and `venue.md` and each type file with `sources:` and cited `rule_ref`s, per `shared/knowledge-tree.md` §8. With `saved_copy`, `Read` that file and mark its items as in section 3, step 3. No tool reads it in a repo run, so it stays in `_inbox\` unhashed, and its source record carries no `pdf_sha256` and so no `pdf_url`, which needs one. A `/draft` run adds the layout block and `venue.md` for a new venue as in section 3, step 4.
4. **Index rows.** The kinds-index row for a new kind (its `file` as `shared/knowledge-tree.md` §4 defines it), any new jurisdiction-index row, and each near-miss alias the resolve surfaced (`source: agent`, `ref` naming the rule), as rows keyed to the shipped `venues.json` or `kinds.json` path.
5. **Periods.** None. A repo run writes nothing, and a period's path is returned nowhere.
6. **Return** (section 7): per requested document the skills-tree-relative path, the full text and the status, plus the index rows and any `saved_path`. A candidate with a passage not matched returns `refused`, reason `excerpt_mismatch`, with the `rule_ref`s, and no text. Never call `knowledge__write`.

## 5. `confirm` and `correct` (matter run only)

A repo run refuses both without a tool call.

- **`confirm`:** `sources__check` with `files: [{tree: "knowledge", path}]`. An item reported `present: false` is not confirmed: return `refused` naming its `rule_ref`. Otherwise `knowledge__write` with `operation: "confirm"`, `path` and `rule_ref`.
- **`correct`:** `knowledge__read` the file, `sources__fetch` its source page, then `knowledge__write` with `operation: "correct"`, `path`, `rule_ref` and `value` in the shape the file's contract declares (`shared/knowledge-tree.md` §10).

## 6. `refresh` and `retire`

**`refresh`, matter run** (only on the practitioner's yes, which the dispatch states):

1. `sources__check` with `tree: "knowledge"` on the file.
2. `sources__fetch` with `match` on each changed source.
3. `knowledge__write` `operation: "create"` with `overwrite: true`: the source record fields and each changed item's passage rewritten, nothing else. The runtime refuses a stale page (`stale_body`) and deletes any `_fetched\` PDF no excerpt records any more.

**`refresh`, repo run:**

1. `sources__check` with `tree: "skill_source"` on the file (it reads the installed copy).
2. `skill_source__read` the file, then `sources__fetch` with `match` on each changed source, as in section 4, step 2.
3. Return `refused`, reason `stale_body`, only when both currency markers parse as dates (ISO `YYYY-MM-DD` or `Month D, YYYY`, the forms the runtime orders) and the fetched one is earlier than the recorded one. Otherwise put both markers in `detail`, do not judge, and go on.
4. Return the path and the full rewritten text, as in section 4, step 6.

**`retire`** (matter run only): `knowledge__retire` with `matter` and either `path` (one overlay file) or `shadowed_only: true` and no path. Return `retired`, any `skipped` and `fetched_deleted` as given. A repo run refuses without a tool call.

## 7. Return shape

One JSON object and nothing else:

```json
{
  "operation": "create",
  "run": "matter",
  "documents": [
    { "kind": "<kind as named>", "status": "created | exists | ambiguous | refused | no_official_source",
      "path": "<relative path, or null>", "candidates": [], "reason": null, "detail": {} }
  ],
  "header": { "venue": "<name>", "document_kind": "<name>", "accessed": "<date>" }
}
```

- `status` by operation: `create` as above, `confirm` → `confirmed`, `correct` → `corrected`, `refresh` → `refreshed`, `retire` → `retired`, or `refused` for any of them. A `retire` also relays the runtime's `skipped` and `fetched_deleted` in `detail`.
- `header` comes from the written file's header fields, for the caller's notice.
- A repo run adds `content` (full text) to each `created` document, and top-level `index_rows` [{path, row}] and `saved_paths`.
- A matter run never returns file content, and no run returns a period file's path.
