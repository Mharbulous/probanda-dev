# Operation: ingest-unattended

Read [`../shared/conventions.md`](../shared/conventions.md) first; derive the live `matter_root` per §2.2 and read `probanda.json` only to confirm initialization; halt on any tool error per §2.3.

Writes. Ingests an explicit list of files **without asking the practitioner anything**. Each point where the interactive path would ask is answered by a default below, or ends that file with a stop reason and the question, for the caller to put to the practitioner later. The machinery is the interactive path's: [`ingest.md`](ingest.md)'s routing, [`ingest-extract.md`](ingest-extract.md) and [`ingest-verify.md`](ingest-verify.md), with the extraction semantics of [`../shared/extraction-protocol.md`](../shared/extraction-protocol.md). Everything in them applies here except the substitutions below. The interactive single-document path is unchanged.

Only one ingestion of a matter runs at a time. Before Step 1, start the run: `matter_data__ingest_run` with `matter_root`, `action: "begin"` and `mode: "unattended"`. A refusal (`ok: false`) ends the call before any file: return its `say` to the caller, never its code, with nothing written. Otherwise pass the returned `run_id` on every `matter_data__execute` call this operation makes. A call refused `lease_lost` means another session took this run over: stop at once, write nothing more, and return its message with the outputs so far. After the Report, end the run: `matter_data__ingest_run` with `action: "end"` and the `run_id`.

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
| `outcome` | `ingested`, `ingested_by_reference`, `superseded`, `partial`, `stopped`, `failed` or `not_ingested` (below) |
| `store` | `main`, `privileged` or `law`, or null when nothing was written or reused |
| `source_ids` | the top-level ids written or reused: `main.sources.source_id` (an affidavit's body, a book's row), `privileged_sources.source_id`, or `authorities.authority_id`. For a copy of an email attachment, the attachment row's `source_id` |
| `ingestion_status` | a main source's `ingestion_status` as the file ends; null for the other stores |
| `file_path` | the stored `file_path` exactly as written |
| `pending` | the markers written (conventions §11): `order_effects`, `linkage`, `date_anchor`, `supersede`, or empty |
| `stop` | with `stopped`: `{stop_reason, question, options}`, each option `{value, label}` |
| `failure` | with `failed`: `{failure_class, reason}` |
| `notes` | what the file's read reported and nothing wrote: email attachments already registered or of a kind ingest cannot read, each with the first 12 hex characters of its SHA-256 so a caller can aggregate repeats across files without re-rendering (design-decisions #53); Path E segments reported but not ingested; an authority reused by citation, or a suspected duplicate authority reported for [`merge-authorities.md`](merge-authorities.md); proceeding linkage findings; the name check's result (Substitution 1a) |

| `outcome` | Means |
|---|---|
| `ingested` | the file now counts as ingested ([`ingest-status.md`](ingest-status.md)): a `complete` main source, a NULL-status main source with child rows, or a privileged or authority row. Pending markers do not change this |
| `ingested_by_reference` | a second file of an authority already held: the citation tier reused it, nothing was extracted, and its `[SECOND-COPY:]` marker was written. Or a standalone copy of an email attachment already read through inside its email: nothing was extracted or written (design-decisions #54) |
| `superseded` | an earlier version of a court document the matter holds, recorded by [`supersede-draft.md`](supersede-draft.md): nothing was written |
| `partial` | registered but not read through: a compound document with deferred parts. The next call continues it |
| `stopped` | the file needs the practitioner's answer before it can be ingested. Nothing was written for it |
| `failed` | the ingest failed, and the failure was recorded (Failures, below) |
| `not_ingested` | nothing was written, for a reason that is neither a question nor a failure: a kind ingest cannot read, a copy of another file, or a suspected authority duplicate reported for merge |

---

## Step 1 — Status, then route

Run [`ingest-status.md`](ingest-status.md) once for the whole list, then route each file by its result and [`ingest.md`](ingest.md) Step 4's table:

| `ingest-status` reports | Route |
|---|---|
| `ingested` from a `complete` main source, a privileged row or an authority row; or `ingested_by_reference` (an authority's second copy, or a copy of an email attachment) | nothing to do: return it as reported, with nothing written. Verification is not required |
| `superseded` | nothing to do: return `superseded`, with nothing written. With `move_pending`, say in `notes` that the file still waits for its move into `0. DRAFT*\Superseded\`, which only the attended gate or folder scan makes ([`supersede-draft.md`](supersede-draft.md) §6c) |
| `ingested` from a main source with a NULL status and child rows | [`ingest-verify.md`](ingest-verify.md) |
| `partial` | continuation: `ingest-verify.md` on the completed portions, then `ingest-extract.md` for the deferred ones |
| `failed` | re-extract from scratch: `ingest-extract.md`, into the existing row by its re-extraction rule |
| `none` with no record, or a main record with no child rows | fresh extraction: `ingest-extract.md`; a main record with no child rows is extracted into that row by its re-extraction rule |
| `none` with `duplicate_of` | `not_ingested`: a copy is never ingested again. Note the other copy's path |
| `anomaly` | `failed`, `deterministic`: "data corruption: more than one top-level source for this hash" |

A file `ingest-status` reports as `moved` keeps its route. Every path this operation writes for it is the file's own `path`.

## Step 2 — Kinds and pre-processing

Attempt `.pdf`, `.docx`, `.eml` and `.msg`, and an RTF `.doc` only as an authority. Any other kind (`.xls`, a non-RTF `.doc`, an image, anything else) is not attempted: `not_ingested`, with the note "a kind ingest cannot read". It is not a failure and writes no review-log row.

Pre-process as `ingest-extract.md` says: render a `.docx`, `.eml`, `.msg` or RTF `.doc` first. An email's attachments are registered and ingested as that section says. A render failure is a `deterministic` failure.

## Step 3 — Route each file from its first page

A file whose `path` the practitioner's folder map marks `privileged` (`practice_data__folder_map` with `paths`) takes Path B by `ingest-extract.md`'s solicitor-client folder rule before any routing read, the caller's included. With no folder map, stop the file before any read (step k's `stop_reason` `other`): question "Probanda does not yet know where you keep each kind of document. Set that up first?", options `setup` ("Set it up now", which the caller runs as `/probanda-setup`) and `later` ("Not now"). Reuse the page-1 routing read this session already made for the file, when its caller made one; otherwise read page 1 now (for `.docx`, `.eml` and `.msg`, the head of the rendering, and for a PDF through `pdf_pages__images` by `ingest-extract.md`'s Universal rules, a scanned page read only from its PNG). An internal document (a client email, a lawyer's note, an internal memo) takes Path B inline and never reaches a subagent. Every other file goes through `ingest-extract.md`'s gates (compound-book segmentation, the affidavit gate, Notice of Application detection) to its path and its extractor.

## Step 4 — Read and write through the orchestrator

A file Step 3 sends to `extract-facts`, `extract-affidavit` (a standalone affidavit) or a Notice of Application's two extractors is read and written by `/lawyer:ingest-orchestrator`'s loop (Skill: `lawyer:ingest-orchestrator`), with this run's `run_id` and `mode` `unattended`: give each such file the route its `references/routing.md` "Route fields" describe, then follow its Steps 3, 4, 5 and 7. Its extractors run in the background, at most 10 at a time, and `matter_data__ingest_result` writes each document; no extraction output and no SQL for it passes through this session. Path B documents are read inline and written last through its Step 5, privileged by default (Substitution 1b). The tools write the markers of Substitutions 1f, 1g, 1h and 1j for what they detect.

Files Step 3 sends elsewhere (an authority, a book, an email's attachments) take `ingest-extract.md` as before:

- **Reads run in parallel, in batches of up to 10 extractor dispatches.** Path E's per-child dispatches count toward the batch like any other. Each document gets a fresh extractor, never a resumed one (SendMessage) and never a fork (`../references/design-decisions.md` #70).
- **Writes run one at a time, in list order.** Within one document, `ingest-extract.md`'s transaction structure is unchanged.
- **Every `file_path` written is the file's stored form** (conventions §2.4): on `main.sources` (an affidavit's exhibits and a book's children included), on `privileged.privileged_sources`, and on `law.authorities` (a book of authorities' rows carry the book's).
- A stop or a failure on one file never halts the list. Continue with the next file.

A file's `outcome` follows from its last `matter_data__ingest_result`: `written` or `already_written` is `ingested` (`partial` while an affidavit's body stays partial); a refusal carrying an `ask` is `stopped`, with that ask as its question (Substitution 1k); a document closed after its extraction failed twice is `failed`, `extractor`.

## Substitutions

1. **No question is ever asked.** Each place `ingest-extract.md` or `ingest-verify.md` would ask is replaced as follows, and no other question exists:
   a. **Name check.** Run its steps 1 and 2 and report the result in `notes`. Step 3, the interactive rename, is dropped. Step 4's rename and stored-path update happen later, when the caller files the file (its own move, then [`relocate-source.md`](relocate-source.md)). This operation renames nothing.
   b. **Path B.** The document goes to the privileged store by default, as if the practitioner had answered "Yes, privileged". Pick its privileged `category` from the read.
   c. **Path A, two plausible pleadings being answered.** Stop: `stop_reason` `target_pleading`, question "Which pleading does <file> respond to?", one option per candidate source (`value` its `source_id`, `label` its title and stored path). With an `answer`, use the chosen source.
   d. **Routing category `other`.** Stop: `stop_reason` `classification`, question "How should <file> be classified?", options `court`, `correspondence`, `production`, `work_product`, `disbursements`, `privileged`, `authority`. With an `answer`, route by the chosen category.
   e. **An authority file (folder-map answer `authority`) no earlier tier could classify** (the cascade's tier 4). Stop: `stop_reason` `authority_kind`, question "What kind of authority is <file>?", options `case_law`, `statute`, `regulation`, `treatise`. With an `answer`, dispatch that kind's extractor.
   f. **Proceeding linkage check** ([`proceedings-profile.md`](proceedings-profile.md) §6). An R1 fail writes the evidence-only marker, and an R3 exact match back-fills, both as usual, since neither asks. A partial match or no match needs the practitioner (the conflict flow, or Backfill's confirm-before-write), so it is deferred instead: append `LINKAGE-PENDING: proceeding linkage check not yet run` (conventions §11) to the source and do nothing else. The file counts as ingested. [`extract-facts.md`](extract-facts.md) §6's whole-matter arm reaches the source on a later scan, and the check then clears the marker. An R2 miss is reported in `notes`.
   g. **Order effects.** When [`order-effects.md`](order-effects.md) Step 1 detection fires, do not run the pass: append `ORDER-EFFECTS-PENDING: order-effects pass not yet run` (conventions §11) to the source. The file counts as ingested. The marker is cleared when the pass runs.
   h. **Date-setting correspondence.** When `ingest-extract.md`'s "Date-setting correspondence" check fires, append `DATE-ANCHOR-PENDING: date not yet recorded as an anchor` (conventions §11) to the source in place of the report line, and invoke nothing else. The file counts as ingested. A note alone would never reach the practitioner, because housekeeping raises no signal from `notes`.
   i. **Partial continuation.** The interactive offer to re-extract the missing parts is an automatic yes.
   j. **Another version of a held court document.** Before reading the files with no record, run [`supersede-draft.md`](supersede-draft.md) §1's `candidates` with those files as newcomers, each one's first path segment as `scan_folder`. Ingest a newcomer it pairs as usual. Then append `SUPERSEDE-PENDING: possible other version of source #<id>.` (conventions §11) to the newcomer's row, one marker per paired row, `<id>` that row. Two newcomers paired with each other are both ingested, and each row is marked with the other's id once both have rows; when either ends with no row, that pair gets no marker. Nothing else is written and nothing is moved. The file counts as ingested. The attended gate and the folder scan settle the pair later. The same marker records a pair §1 did not find. When the session concludes, during or after a file's read, that the file is another copy of registered source `<id>` (`ingest-extract.md`, "Another copy of a registered source"), finish the document's transaction as its path says, then append the marker to the file's row. That conclusion is never recorded in a note alone.
   k. **Anywhere else** `ingest-extract.md` or `ingest-verify.md` would stop and ask, stop the file instead: `stop_reason` `other`, with the question and options it would have asked.

   The marker writes in f, g, h and j run after the document's transaction commits, each in its own `matter_data__execute` call, in `ingest-extract.md`'s order: linkage, then order effects, then the date anchor, then the supersession marker.
2. **A PDF affidavit body is registered `partial`** in its body transaction (`ingest-extract.md` Path C, Pass 1 step 3) and flipped at the end. A crash between exhibits then leaves `partial`, never a NULL status with children.
3. **An authority matched by citation.** The citation tier (`extraction-protocol.md`, "Duplicate routing") reuses an existing authority on an exact citation or a shared neutral token. Extract nothing: Path D's second-copy rule (`ingest-extract.md`) records the file by reference. Return `ingested_by_reference` with the id of the authority that received the marker. A reporter-token or title-only match writes nothing: `not_ingested`, with the suspected duplicate noted for `merge-authorities.md`.

## Failures

| `failure_class` | When |
|---|---|
| `deterministic` | the file cannot be read this way at all: a render failure (an RTF `.doc` included), data corruption (Step 1) |
| `extractor` | the reader failed: an extractor unavailable, failing, or returning malformed JSON; a Path A validation abort (an unresolved locator, an invalid key or enum, a position written as a fact) |

A failed file writes what `ingest-extract.md`'s own failure rules write, and nothing more. Never substitute another agent for an unavailable extractor. Then record the failure through [`housekeeping-log.md`](housekeeping-log.md) mode `record` (ingest failures): `file_name` the file's basename, `file_hash`, `folder_type` from the input, `reason` one sentence saying what failed, and `failure_class`. That mode sets whether the next run retries it automatically. Return `failed` with the class and reason.

A stop is not a failure and writes no review-log row.

## Report

Return the per-file output above. Also give `extraction-protocol.md`'s per-run report once for the whole call: counts by entity type, skipped duplicate locators, the verification backlog produced, and each source's final `ingestion_status`.
