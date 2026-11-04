# Operation: ingest-unattended

Read [`../shared/conventions.md`](../shared/conventions.md) first; derive the live `matter_root` per §2.2 and read `probanda.json` only to confirm initialization; halt on any tool error per §2.3.

Writes. Ingests an explicit list of files **without asking the practitioner anything**. Each point where an attended ingest would ask is answered by a default below, or ends that file with a stop reason and the question, for the caller to put to the practitioner later. The machinery is the orchestrator's: [`../../ingest-orchestrator/references/routing.md`](../../ingest-orchestrator/references/routing.md) routes each file, and `/lawyer:ingest-orchestrator`'s loop (Skill: `lawyer:ingest-orchestrator`) reads and writes it. **This session reads no extractor's result and composes no write, for any file** (design-decisions #79). What the tools cannot do without the practitioner is `held` for an attended `/ingest`. The extraction semantics are the tools' and the extractors'.

Several ingestions of a matter may run at once. Before Step 1, start the run: `matter_data__ingest_run` with `matter_root`, `action: "begin"`, `mode: "unattended"` and `orchestrator: true`. A refusal `run_unfinished` names a stopped run: resume it with no question, `begin` with `resume` set to its `run_id`, `mode: "unattended"` and `orchestrator: true`, and go on with what it lists; a file routed again keeps its ref. Any other refusal (`ok: false`) ends the call before any file: return its `say` to the caller, never its code, with nothing written. Return any `report` lines that `begin` or `end` gives with the outputs. Before reading any file, claim the list: `matter_data__ingest_run` with `action: "claim"`, the `run_id` and `files` (each `{file_path, file_hash, attachment_hashes?}`). A file not in the returned `claimed` is held by another session: its outcome is `not_ingested`, with the `report` line for it in its `notes`. A call refused `lease_lost` means another session took this run over: stop at once, write nothing more, and return its message with the outputs so far. A call refused `plugin_changed` means Probanda was updated mid-run: stop at once, write nothing more, return its message with the outputs so far, and do not end the run, so its journal keeps what was read for the next ingest of the matter to resume. Otherwise, after the Report, end the run: `matter_data__ingest_run` with `action: "end"` and the `run_id`.

---

## Input

| Field | Meaning |
|---|---|
| `matter_root` | the live host path of the matter folder (conventions §2.2) |
| `matter_folder` | the same folder as this session's filesystem sees it: the mounted folder in a Cowork session, `matter_root` itself locally |
| `files` | the caller's explicit, capped list, in order. Never a folder walk. Each entry is `{path, hash, folder_type, answer?}`: `path` in the stored form (conventions §2.4); `hash` the lowercase hex SHA-256 of its bytes; `folder_type` the caller's housekeeping folder type for the folder holding the file, or null at the matter root (recorded on a failure); `answer`, when present, the practitioner's choice on a question this operation returned for the file on an earlier run: `{stop_reason, choice}`, `choice` one of that question's option values |

## Output, one entry per file, in input order

| Field | Meaning |
|---|---|
| `outcome` | `ingested`, `ingested_by_reference`, `superseded`, `partial`, `stopped`, `held`, `failed` or `not_ingested` (below) |
| `store` | `main`, `privileged` or `law`, or null when nothing was written or reused |
| `source_ids` | the top-level ids written or reused: `main.sources.source_id` (an affidavit's body), `privileged_sources.source_id`, or `authorities.authority_id`. For a copy of an email attachment, the attachment row's `source_id` |
| `ingestion_status` | a main source's `ingestion_status` as the file ends; null for the other stores |
| `file_path` | the stored `file_path` exactly as written |
| `pending` | the markers on the record (conventions §11): `order_effects`, `linkage`, `date_anchor`, `supersede`, `treatment`, or empty |
| `stop` | with `stopped`: `{stop_reason, question, options}`, each option `{value, label}` |
| `failure` | with `failed`: `{failure_class, reason}` |
| `notes` | what the file's read reported and nothing wrote: the tools' `report` lines; email attachments already registered, not read here or of a kind ingest cannot read, each with the first 12 hex characters of its SHA-256 so a caller can aggregate repeats across files without re-rendering (design-decisions #53); a suspected duplicate authority reported for [`merge-authorities.md`](merge-authorities.md); the name check's result (Substitution 1a) |

| `outcome` | Means |
|---|---|
| `ingested` | the file now counts as ingested ([`ingest-status.md`](ingest-status.md)): a `complete` main source, a NULL-status main source with child rows, or a privileged or authority row. Pending markers do not change this |
| `ingested_by_reference` | a second file of an authority already held: the citation tier reused it, nothing was extracted, and the tool wrote its `[SECOND-COPY:]` marker. Or a standalone copy of an email attachment already read through inside its email: nothing was extracted or written (design-decisions #54) |
| `superseded` | an earlier version of a court document the matter holds, recorded by [`supersede-draft.md`](supersede-draft.md): nothing was written |
| `partial` | an affidavit whose body is written and whose exhibits were not all read. An attended `/ingest` continues it |
| `stopped` | the file needs the practitioner's answer before it can be ingested. Nothing was written for it |
| `held` | the run cannot read this file without the practitioner: nothing was written, no review-log row, and one line in `notes` says why and asks for an attended `/ingest` |
| `failed` | the ingest failed, and the failure was recorded (Failures, below) |
| `not_ingested` | nothing was written, for a reason that is neither a question nor a failure: a kind ingest cannot read, a copy of another file, a file another session holds, or a suspected authority duplicate reported for merge |

---

## Step 1 — Status, then route

Run [`ingest-status.md`](ingest-status.md) once for the whole list, then treat each file by its result:

| `ingest-status` reports | Route |
|---|---|
| `ingested` from a `complete` main source, a privileged row or an authority row; or `ingested_by_reference` (an authority's second copy, or a copy of an email attachment) | nothing to do: return it as reported, with nothing written. Verification is not required |
| `superseded` | nothing to do: return `superseded`, with nothing written. With `move_pending`, say in `notes` that the file still waits for its move into `0. DRAFT*\Superseded\`, which only the attended gate or folder scan makes ([`supersede-draft.md`](supersede-draft.md) §6c) |
| `ingested` from a main source with a NULL status and child rows | nothing to do: return `ingested`, with nothing written. Its verification waits for an attended `/ingest` |
| `partial` | `held`: a continuation of an unfinished read is an attended `/ingest`'s |
| `failed` | Step 2. The route reads it afresh, and the tool's write reuses the existing row by the re-extraction rule |
| `none` with no record, or a main record with no child rows | Step 2; a main record with no child rows is written into that row by the re-extraction rule |
| `none` with `duplicate_of` | `not_ingested`: a copy is never ingested again. Note the other copy's path |
| `anomaly` | `failed`, `deterministic`: "data corruption: more than one top-level source for this hash" |

A file `ingest-status` reports as `moved` keeps its route. Every path this operation routes for it is the file's own `path`.

## Step 2 — Kinds

Attempt `.pdf`, `.docx`, `.eml` and `.msg`, and an RTF `.doc` only as an authority. Any other kind (`.xls`, a non-RTF `.doc`, an image, anything else) is not attempted: `not_ingested`, with the note "a kind ingest cannot read". It is not a failure and writes no review-log row.

## Step 3 — Route each file

Before reading the files with no record, run Substitution 1j's `candidates`. Then take each file Step 1 left through the checks of `routing.md`'s "The interim gate", in order, by its unattended lines, and give it the route its "Route fields" describe. A check's answer ends a file like this:

| What the check finds | Outcome |
|---|---|
| A render failure, or a page-1 refusal from `pdf_pages__images` | `failed`, `deterministic` |
| A folder the folder map marks `never_ingest` | `not_ingested`, with the reason in `notes` |
| No folder map | stop the file before any read (Substitution 1k): question "Probanda does not yet know where you keep each kind of document. Set that up first?", options `setup` ("Set it up now", which the caller runs as `/probanda-setup`) and `later` ("Not now") |
| A compound book, or the book-of-authorities cascade | `held` |
| An authority with a tier-1 or tier-2 match, or none | Substitutions 1e and 3 |

A file the folder map marks `privileged`, and an internal document (a client email, a lawyer's note, an internal memo), takes `kind: "path_b"`, privileged by default (Substitution 1b), and never reaches a subagent. Reuse the page-1 routing read this session already made for the file, when its caller made one. An `answer` applies here: `target_pleading` is the route's `answers_source_id`, `authority_kind` its `kind`, and `classification` routes by the chosen category and goes on the file's `ingest_result` call as `answers.category`.

## Step 4 — Read and write through the orchestrator

Pass all the routes in one `matter_data__ingest_run` `next` call and follow `/lawyer:ingest-orchestrator`'s Steps 2 to 8 as their unattended lines say, with this run's `run_id` and `mode` `unattended`. It runs extractors in the background, at most 10 at a time, each document with a fresh one, and `matter_data__ingest_result` writes each document in its own transaction, one at a time. No extraction output and no SQL passes through this session. Path B documents are read inline and written last through its Step 5; one over its page limit is `held`. A stop or a failure on one file never halts the list. Continue with the next file. Every `file_path` a tool writes is the file's stored form (conventions §2.4).

A file's `outcome` follows from its last `matter_data__ingest_result`:

| The last result | Outcome |
|---|---|
| `written` or `already_written` | `ingested` (`partial` while an affidavit's body stays partial; `ingested_by_reference` for a route with `second_copy_of`), with its `report` lines and any `ask` it carries in `notes` (an exhibit or an attachment held back pending, a privileged informant left out of the record) |
| A refusal carrying an `ask` | `stopped`, with that ask as its question (Substitution 1k). `next` then lists it under `asked`, never again as a write, so the loop ends without it |
| Refused `path_b` | Path B (Substitution 1b) |
| Refused `set_aside`, `race` or `store_change` | `held` |
| Refused `already_held` or `taken` | `not_ingested`, with its report line in `notes` |
| Refused `unresolved`, or any other refusal | `failed`, `extractor` (Failures, below), with its report line as the reason |
| A document closed after its extraction failed twice | `failed`, `extractor` |

An attachment's own result never changes its email's outcome: it goes in the email's `notes`. Each `failed` file takes Failures' review-log row.

After the last write, run [`ingest-status.md`](ingest-status.md) once more over the files written: each entry's `pending`, `store`, `source_ids` and `stored_path` fill that file's output, and its verdict gives `ingestion_status`.

## Substitutions

1. **No question is ever asked.** Each place an attended ingest would ask is replaced as follows, and no other question exists:
   a. **Name check.** Run its steps 1 and 2 (the orchestrator's Step 7) and report the result in `notes`. The interactive rename is dropped. The rename and stored-path update happen later, when the caller files the file (its own move, then [`relocate-source.md`](relocate-source.md)). This operation renames nothing.
   b. **Path B.** The document goes to the privileged store by default, as if the practitioner had answered "Yes, privileged". Pick its privileged `category` from the read.
   c. **Path A, two plausible pleadings being answered.** Stop: `stop_reason` `target_pleading`, question "Which pleading does <file> respond to?", one option per candidate source (`value` its `source_id`, `label` its title and stored path). With an `answer`, use the chosen source.
   d. **Routing category `other`.** Stop: `stop_reason` `classification`, question "How should <file> be classified?", options `court`, `correspondence`, `production`, `work_product`, `disbursements`, `privileged`, `authority`. With an `answer`, route by the chosen category.
   e. **An authority file (folder-map answer `authority`) no earlier tier could classify** (the cascade's tier 4). Stop: `stop_reason` `authority_kind`, question "What kind of authority is <file>?", options `case_law`, `statute`, `regulation`, `treatise`. With an `answer`, route that kind's extractor.
   f. **Proceeding linkage check** ([`proceedings-profile.md`](proceedings-profile.md) §6). Not run here. The tool appends `LINKAGE-PENDING: proceeding linkage check not yet run` (conventions §11) to a court document's source. The file counts as ingested. [`extract-facts.md`](extract-facts.md) §6's whole-matter arm reaches the source on a later scan, and the check then clears the marker.
   g. **Order effects.** Not run here. When [`order-effects.md`](order-effects.md) Step 1 detection fires, the tool appends `ORDER-EFFECTS-PENDING: order-effects pass not yet run` (conventions §11) to the source. The file counts as ingested. The marker is cleared when the pass runs.
   h. **Date-setting correspondence.** When the extractor flags a date set by the forum, the tool appends `DATE-ANCHOR-PENDING: date not yet recorded as an anchor` (conventions §11) to the source. The file counts as ingested. A note alone would never reach the practitioner, because housekeeping raises no signal from `notes`.
   i. **Partial continuation.** Never made here: the file is `held`.
   j. **Another version of a held court document.** Before reading the files with no record, run [`supersede-draft.md`](supersede-draft.md) §1's `candidates` with those files as newcomers, each one's first path segment as `scan_folder`. Route a newcomer it pairs as usual, with each registered row's id in `possible_versions` and each other newcomer's hash in `version_newcomers`. The tool appends `SUPERSEDE-PENDING: possible other version of source #<id>.` (conventions §11) in the document's transaction, one marker per paired row. Two newcomers paired with each other are each marked with the other's id once both have rows; when either ends with no row, that pair gets no marker. Nothing else is written and nothing is moved. The file counts as ingested. The attended gate and the folder scan settle the pair later. The tool writes the same marker for a pair §1 did not find, when the extractor reports one.
   k. **Anywhere else** an attended ingest would stop and ask, stop the file instead: `stop_reason` `other`, with the question and options it would have asked.
2. **A PDF affidavit body is registered `partial`** by the tool's body write and flipped when its last exhibit is written. A crash between exhibits then leaves `partial`, never a NULL status with children.
3. **An authority matched by citation.** `routing.md`'s "Authorities, unattended" says when the citation tier reuses an existing authority. Extract nothing: route it with `second_copy_of`, and the tool records the file by reference. Return `ingested_by_reference` with the id of the authority that received the marker. A reporter-token or title-only match writes nothing: `not_ingested`, with the suspected duplicate noted for `merge-authorities.md`.
4. **A decision's treatment of an earlier one.** The tool writes it as a `[TREATMENT-PENDING:]` marker (conventions §11) in the authority's transaction, and the session never sees it. Matching it to the treated authority stays an attended judgment.

## Failures

| `failure_class` | When |
|---|---|
| `deterministic` | the file cannot be read this way at all: a render failure (an RTF `.doc` included), data corruption (Step 1) |
| `extractor` | the reader failed: an extractor unavailable, failing, or returning malformed JSON; a validation abort (an unresolved locator, an invalid key or enum, a position written as a fact) |

A failed file writes what the tool's failure rules write, and nothing more. Never substitute another agent for an unavailable extractor. Then record the failure through [`housekeeping-log.md`](housekeeping-log.md) mode `record` (ingest failures): `file_name` the file's basename, `file_hash`, `folder_type` from the input, `reason` one sentence saying what failed, and `failure_class`. That mode sets whether the next run retries it automatically. Return `failed` with the class and reason.

A stop is not a failure and writes no review-log row. Neither is `held`.

## Report

Return the per-file output above, with each file's outcome in one short line.
