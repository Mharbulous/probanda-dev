Read when: building the work list (Step 7), reading page 1 and flagging firm drafts (Step 8), running the ingest (Step 9), or dispatching the page-1 reader and assembling naming evidence (Step 10) of `/housekeeping`.

# Housekeeping: work list, page-1 reads and ingest

`/matter-data`'s `render_document.py` script, in the `references` scripts folder of the installed `lawyer` plugin's `matter-data` skill, renders a `.docx`, `.eml` or `.msg` and cuts its head (`--head-chars`).

## Step 7 — Build the work list

Make **one** `housekeeping__candidates` call. It lists, hashes, name-gates and looks up every candidate on the host, admits, orders and caps, and returns only the admitted files: no file list, hash or gate output passes through this session. Pass only what Step 2 and Step 5 produced:

- `matter_root`, `run_id`;
- `swept_folders`: each folder the folder map matches, by its on-disk name, `{path, folder_type, flag_tokens?, second_pass?}`, `folder_type` the folder type's name (`Correspondence`, `Law`, `Court File`, `Discovery`), `flag_tokens` the Law folder's, `second_pass: true` on Law and Discovery;
- `skip_folders`: the root folders the profile always skips;
- the argument (above): `subfolder` for a subfolder path, `files` for a file list (stored form), `force: true` for `--force`;
- `finished`: the stored paths Step 5 finished, which take no place in this run.

It applies these rules, which this session never re-applies:

- **Hashing.** A file that cannot be read is in `errors` with its error: it leaves the run and is named in the report. Hashing a cloud-only file (one the folder's sync client holds only online) downloads it.
- **Name gate and second pass** over every subfolder file's current name, with the Law folder's flag tokens. The profile's mechanical second-pass forms (Law's citation and AI-memo forms, Discovery's listed-document form and its legacy bare item numbers) **conform**. A Law name whose gate result carries a flag token does not conform. A failure in a Law or Discovery folder that matches neither form is `second_pass_required`: it counts as not conforming, so it is admitted unless a settled verdict matches, and this session judges its name against the folder's notes when it builds the row (Step 12).
- **Ingest status and review log** per file, as `/matter-data`'s `ingest-status` and the review log's lookup define them. A file counts as **ingested** when its verdict is `ingested`, `ingested_by_reference` or `superseded` (an earlier version of a court document case data holds); verification is not required. A `duplicate_of` file is a **duplicate** (the later of two identical files, or a copy of a file still at its stored path): never ingested, never re-pointed. Keep the pick of which copy is the duplicate; never swap it, even when the other copy is already filed. A `moved` file was moved by hand: it is ingested, and `relocate-source` repairs its stored path when it is filed.
- **Admission.** A root file is always admitted; the review log is never consulted for it. A subfolder file is admitted when **(its name does not conform AND no settled verdict matches it)** OR **(it is not ingested AND no `not_ingested` row matches its hash)**. `--force` drops the settled-verdict condition from the first arm only.

It returns `header` (`open_in_word`, `folders_not_looked_inside`), `errors`, `admitted` and `deferred`, as unindented JSON. Each `admitted` row carries only what Steps 8 to 13 read: `path`, `hash`, `location`, `folder_type`, `admitted_by`, `name` (`verdict`, `reason`, `flags`; null for a root file), `ingest` (`verdict`, `store`, `source_ids`, `moved`, `duplicate_of` with `twin_ingested`, `pending` markers, `metadata`, `anomaly`, `superseded_by`, `move_pending`, `possible_version_of`) and, when the review log remembers one, `ingest_failure` (its reason and whether the next run retries it automatically). An `ingest` field that is null, false or empty is left out. Its `metadata` holds the stored date, category and parties that Step 12 cross-checks, and on a duplicate the twin's whole stored record, which Step 11 composes from. The `admitted` list, in its order, is this run's rows, read or not: only these files go on to Step 8 and Step 9. Each `deferred` file (`path`, `hash`) is a `deferred` row: it is recorded in `proposal.json` for the count and nothing else happens to it. Never reorder, trim or extend either list: `housekeeping__write_run_file` refuses a `proposal.json` whose rows break the order or the cap. A call that fails past its time budget returns no list: say so, and offer a run on one subfolder or a file list.

## Step 8 — Page-1 routing read

First ask `/matter-data` for the matter's filing lawyer and firm, client name, party names and every proceeding's court file number. The firm-draft check below and Step 11 use them.

For each row that **needs ingest** (not ingested, not a duplicate, a kind ingest reads, and not a remembered ingest failure that is not due its automatic retry), read page 1 inline, in this session. For `.eml`, `.msg` and `.docx`, page 1 is the head of the rendering, staged first in a bridged session. For a `.pdf`, first call lawyer's `pdf_pages__images` with `pages: "1"` (`/matter-data`'s design decision #71). Read a `scanned` page 1 only from its PNG, never from the PDF or its text layer, and a `born_digital` one with `Read` `pages: "1"`. In a bridged session, stage the PNG before reading it, by the Universal rules of `/matter-data`'s ingest-extract operation. A refusal makes the row a "Could not read" row, with the refusal's reason. Kinds ingest reads: `.pdf`, `.docx`, `.eml`, `.msg`, and an RTF `.doc` (it begins `{\rtf`) as an authority. A `.msg` that fails to render is a deterministic ingest failure that `ingest-unattended` records, not a kind ingest cannot read. Every other kind (`.xls`, a non-RTF `.doc`, images, and any other root kind) is not attempted: it becomes a "Could not read" row. An image can still be looked at: the page-1 reader takes it (Step 10), so it gets a proposed name.

From each page-1 read, record the routing (an internal document such as a client email, a lawyer's note or a memo goes to the privileged store; an authority; any other document). Record the facets of a naming-evidence block (Step 10) only for a row this read routes to the privileged store and for a flagged draft (below), because no subagent sees either: `filing_stamp` and `signature` among them, and `transmission` when page 1 prints a delivery line ("By Email", "Via Fax and Email"). Every other row's block comes from the page-1 reader.

**Firm drafts, root files only.** For every root document read here, record four facts from page 1, each with its quote or the word `absent`:

- `firm_authored`: the author side is the firm acting for this matter. The letterhead, signature block or "Solicitors for" line names the matter's recorded filing lawyer or firm, or, when none is recorded, a lawyer or firm the document itself shows acting for the matter's client ("we act for", "our client", "Our File"); or it is a court document whose filing party is the client. Never decided from the practitioner's own firm profile.
- `draft_marking`: the words DRAFT, "for discussion", "not sent", or a version tag.
- `signature`: a signed signature line. A blank "Per:" line or an unsigned name block is `absent`. The naming-evidence `signature` facet from this read follows the same rule.
- `sent_or_filed`: evidence the document went out: an email header or sent-items print, a filing stamp, or a served-on or received stamp. A typed transmission line ("By email") or a typed date alone is not this evidence, because drafts carry them before anything is sent. The `transmission` facet records that typed line for naming only, and this check never reads it.

Flag "Looks like your unfinished draft" when `firm_authored` is present and either `draft_marking` is present or both `signature` and `sent_or_filed` are `absent`. A served but unfiled copy from the other side is a record, not a draft (`firm_authored` absent). Keep the four facts, the absent ones included ("no signature, no sent date"), as this session's evidence for choosing the row's action. A flagged file is left out of this run's ingest.

## Step 9 — Ingest

Repeat the half-commit check (`housekeeping__preflight`). Then make **one** `/matter-data` `ingest-unattended` call with the explicit capped list: every row that needs ingest (Step 8) except flagged drafts, in row order, each `{path, hash, folder_type}` (`folder_type` the keyword table's type name for the folder holding the file, such as `Correspondence`, `Law` or `Court File`; null at the root). Never a folder walk, and never two calls on one matter at once. The call writes each document in its own transaction, in list order, never several documents in one write. It reuses this session's page-1 reads, asks nothing, ingests an internal document into the privileged store by default, writes the pending markers for order effects and linkage instead of running those passes, and records every failure in the review log itself, with whether the next run retries it (an extractor failure the first time: yes; a deterministic failure, or any later failure: no).

Per file it returns `outcome` (`ingested`, `ingested_by_reference`, `partial`, `stopped`, `failed`, `not_ingested`), store, source ids, the stored path as written, `pending`, `stop` (the question and its options), `failure` (class and reason) and `notes`. Keep every `stop` for Step 13's `questions.json`.

Then make one more `ingest-status` call over the files ingested in this step: its `metadata` is the ingest record Step 12 cross-checks the proposal against.

## Step 10 — Naming evidence from page 1

Each facet of a naming-evidence block carries a verbatim quote and a pinpoint, or is absent: `title`; `dates[]` with kind (created, signed, sworn, filed stamp, sent, decision, other); `author`; `recipients[]` with capacity; `style_of_cause`; `court_registry`; `action_number`; `affidavit_number`; `filing_stamp`; `signature`; `operative_language` (serves, encloses, neither); `transmission` (printed delivery methods, in printed order); `attachments_referenced[]`; `amounts[]`; `contradictions[]` (paired quotes); `other_matter_signals[]`; for a Law-folder file `caption`, `court` and `decision_date`; `readability`; `pages_read`. Page 1 names a document better than the whole of it: a longer read names something inside the document instead of the document itself.

**The reader.** Every admitted row the list below does not exclude gets one page-1 read by the `housekeeping-reader` agent, whether it was ingested before this run, ingested now, or not ingested at all. The stored record is not a source of evidence. Dispatch every reader **in one turn**, in parallel, one per row: Agent tool, `subagent_type: "file-manager:housekeeping-reader"`, `model: "haiku"`, `effort: "medium"`. If that agent type is not in this session's roster, stop and say so; no other agent reads for names. Each dispatch carries `{row_id, path, kind, in_law_folder, matter}`, a `.pdf` with `page_manifest` and `page_count` in place of `path`, `matter` being the party names and court file numbers fetched at the start of Step 8:

- A `.pdf`: `kind` `pdf`, no `path`, and page 1 from `pdf_pages__images` with `pages: "1"` (Step 8's call for a row it read, and a fresh call for every row Step 8 did not read). `page_manifest` is `[{"page": 1, "images": [...]}]` with the PNG paths when page 1 is `scanned`, else `[{"pages": "1", "pdf": "<the file's path>"}]`, and `page_count` is the result's `page_count`. A refusal makes the row a "Could not read" row, with the refusal's reason.
- An image: `kind` `image`, the file's own path.
- A `.docx`, `.eml` or `.msg`, or an RTF `.doc`: `kind` `rendering`, the head of its rendering. Run `render_document.py <file> <temp_dir> --head-chars 900` into an OS temp folder (never the matter tree) and pass the `head_path` it prints. 900 characters stays inside page 1: a cut that runs into page 2 names something inside the document.
- In a bridged session the reader cannot see the matter folder: stage a byte-exact copy of the file, of the head, or of each PNG, into the session first and pass that path, by the Universal rules of `/matter-data`'s ingest-extract operation. Never pass a directory.

A reply that is missing or does not follow the agent's output contract is re-dispatched once. If it fails again, the row gets the signal "The reader returned an unusable report" (`uncertain_name`) and no proposal.

A report with `readability` `partial` or `poor` on a `scanned` page 1 is read once more in tiles (`/matter-data`'s design decision #71): call `pdf_pages__images` again with `pages: "1"` and `tiles: true`, and re-dispatch that row's reader with those tiles as page 1's `images`. The second report replaces the first. There is no third read.

**Rows the reader never sees,** each with its own source:

- **A privileged-store row** (stored there, or routed there by Step 8): this session's own page-1 read, Step 8's for a row it read, else a page-1 read made now (the head of the rendering for `.eml`, `.msg` and `.docx`, and for a `.pdf` Step 8's page-image read).
- **A flagged firm draft:** Step 8's facets.
- **A row under a folder named `privileged` or `disclosed`:** always `stuck` (**Rows**), so it is not read.
- **A duplicate:** composed from its twin's stored record (Step 11).
- **Could not read, or held back by a remembered failure:** no block, no proposal.
