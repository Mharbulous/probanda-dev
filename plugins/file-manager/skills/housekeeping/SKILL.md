---
name: housekeeping
disable-model-invocation: true
description: Read the loose files in a litigation matter's main folder into the case database, name each one by the firm's file naming convention (date + code + author/recipient + re/encl/srv + subject + amount) and file it into the matter's folders, and tidy files already in its subfolders that were never read in or carry non-standard names, after the practitioner approves each file on a local approval page. Use for 'housekeeping', or to clean up, organize, audit, standardize, or fix non-standard file names in a litigation matter folder. Litigation matters only.
---

<!-- file-manager v0.4.1 -->
> **Installed copy.** This skill's full source tree ships beside this file, and a relative path in the text below cites that tree. Resolve one by trying, in order: the directory of the file you are reading, then `${CLAUDE_SKILL_DIR}/<path>`, then `${CLAUDE_SKILL_DIR}/../<path>` (so `shared/x.md` is at `${CLAUDE_SKILL_DIR}/../shared/x.md`). The host substitutes `${CLAUDE_SKILL_DIR}` with the directory holding this SKILL.md when this file loads; if the literal text `${CLAUDE_SKILL_DIR}` is what you see, that IS the definition: it means the directory containing this SKILL.md, not a placeholder to search for or guess. Read references and shared files natively from there, never over the litigation data server's skill-source tool and never by requesting folder access; scripts and templates the text declares are executed and read from there too. If `${CLAUDE_SKILL_DIR}` itself no longer exists, the plugin was re-synced mid-session: list only `${CLAUDE_SKILL_DIR}/../../..` (the folder that held this plugin's folder), take the folder named as this plugin's folder with any `~g<N>` suffix removed plus the highest `~g<N>`, and repeat the same three tries with its `skills/<this skill>` directory in place of `${CLAUDE_SKILL_DIR}`; tell the user once that the plugin updated mid-session, from the version in this file's version comment to the version in that folder's copy of this SKILL.md. If a file the text names is missing at every one of those paths, including the re-synced folder's, STOP and report the exact path and error to the user rather than substituting an alternative: do not re-derive a script's logic from its source text or the prose, and do not search elsewhere on the filesystem. Ask the user to reinstall the plugin and fully restart the app; this may fix it, but STOP means stop regardless: do not diagnose further yourself.
> **HTML pages.** Every HTML file this plugin writes is a human interface generated from its databases; an agent never views, reads, greps, parses, scripts over, stages, authors or requests a screenshot of one, but may present one to a human user to view, and may view a screenshot the user provides on their own initiative. The rule and the data to use instead: `shared/html-pages.md`.

## Contents

| Section | Read when |
|---|---|
| Terms | A term (root, row, `matter_root`, stored form, run directory) is unclear |
| Arguments | The run is invoked with a subfolder, a file list or `--force` |
| Step 1 — Model | Deciding which model reads and which is pinned |
| Step 2 — Profile | Start of a run, to detect the profile and scope the folders |
| Step 3 — Half-commit check | Start of a run, and before every write phase |
| Step 4 — Case database and schema | After the profile, to check the case database and schema |
| Step 5 — Finish interrupted approvals | Before building anything, to finish earlier approved runs |
| Step 6 — Build the candidate list | Listing, hashing and name-gating candidate files |
| Step 7 — Ingest status, then admit, order and cap | Deciding which files are admitted and in what order, up to 50 |
| Step 8 — Page-1 routing read | Reading page 1 of files that need ingest, and flagging firm drafts |
| Step 9 — Ingest | Running the one capped ingest call |
| Step 10 — Naming evidence and gap-fill reads | Assembling each row's naming-evidence block |
| Step 11 — Compose | Composing names and destinations, dispatching the namer |
| Step 12 — Rows: checks, signals and precomputes | Building rows, checking destinations, collisions and name checks |
| Step 13 — Write `proposal.json` and serve the page | Writing the proposal and serving the approval page |
| Step 14 — Wait for Approve | Waiting for the practitioner's approval |
| Step 15 — Apply | Applying approved rows |
| Step 16 — Report | After apply, to report and handle files left as is |
| Recovery | A run was interrupted, or after a compaction |
| Rows | Choosing a row's section, signals or its one action |
| Row kinds at apply | Applying a row, to see its steps, review-log entry and journal line |
| The review log | Writing or interpreting review-log rows |

# Housekeeping (orchestrator)

The matter's main folder is its inbox: a file sitting loose there has not yet been read into the case database. One run reads each such file once, and that one read both records the document in the case database and supplies the evidence for its proper name and folder. Reading runs unattended. Everything is saved for one approval page, one line per file proposing one action, and **nothing is renamed or moved until the practitioner picks Approve on it and presses Submit**. Moving into the folder is always the last step for a file. Files already in the subfolders are tidied too when they were never read in, or carry a non-conforming name the practitioner has not settled.

**A file renamed or filed wrongly is worse than one left alone**: it can hide a deadline or break a search. When the evidence does not establish a name or a folder, the row proposes `stuck` (leave it where it is) with a short reason, never a guess.

This skill is the only front door, for litigation matters only, and holds **no database particulars**. It reaches data only through these public interfaces:

- `/case-data`: `pointer-health`, `ingest-status`, `ingest-unattended`, `relocate-source`, and `housekeeping-log` (modes `lookup`, `record`, `retry`). A matter's parties, court file numbers, client name and recorded filing lawyer and firm come from its ordinary read operations.
- `/drafting-data`: re-pointing its stored document paths after a move ("Re-point after a move").
- `/file-sorting`: `detect-profile`, `scope`, `record-backend`, and the litigation-matter profile's folder notes. `/file-apply`: `../file-apply/scripts/hash_files.py`. `/file-naming` (in the `legal` plugin): the **gate** intent, invoked through the Skill tool, and its references, read with `skill_source__read`.
- The `file-manager` plugin's `files` server tools (prefix `mcp__plugin_file-manager_files__`, or its Cowork-bridged name): `housekeeping__preflight`, `housekeeping__new_run`, `housekeeping__order_candidates`, `housekeeping__write_run_file`, `housekeeping__serve_page`, `housekeeping__wait_approval`, `housekeeping__resolve`, `housekeeping__reconcile`, `housekeeping__journal_append`, `file_ops__move`, `file_ops__trash`. The `legal` plugin's data server tool (prefix `mcp__plugin_legal_data__`, or its Cowork-bridged name): `research_filing__append_manifest`.
- The `housekeeping-namer` agent (`file-manager:housekeeping-namer`).

## Terms

- **Root**: the matter folder itself. **Run**: one `/housekeeping` invocation on one matter. **Row**: one file on the page.
- **Swept folder**: a folder matching the profile's folder-type keyword table, and every folder inside it, excluding folders numbered 0 or 1, `TRASH`, and anything inside a folder the table does not match.
- **`matter_root`**: the matter folder's live host path, as `/case-data` derives it. Every `housekeeping__*`, `file_ops__*` and `/case-data` call takes it. **`matter_folder`**: the same folder as this session's own filesystem sees it (the mounted folder in a Cowork session, `matter_root` itself locally). Listing, hashing and reading happen there.
- **Stored form** of a path: matter-root-relative, backslash separators, no drive letter, no leading `\` or `.\`. Every path in `proposal.json` and every path handed to `/case-data` or `/drafting-data` uses it.
- **Run directory**: `<case-data folder>\housekeeping\<run-id>\`, the case-data folder being the one `probanda.json`'s `case_data_dir` names. It must already exist (`housekeeping__new_run` fails `case_data_missing` otherwise); the server creates `housekeeping` beneath it. The server writes every file in it; this session only reads it, in a Cowork session after requesting access to the case-data folder itself (never a parent). Run directories are never deleted.

## Arguments

| Argument | Effect |
|---|---|
| none, or the matter root | the full run |
| a subfolder path | sweep only that folder (and the folders inside it), per the profile's argument rule. No root files |
| a file list | only those files, root or subfolder |
| `--force` | the review log's settled verdicts no longer keep a subfolder file off the work list (Step 7's name arm). It never overrides the ingest arm. Say so in the opening message |

## Step 1 — Model

No model gate. Reading runs on the session's model: the extractors inherit it, and so do this session's page-1 reads and inline reads. Only the namer is pinned (Sonnet, Step 11).

## Step 2 — Profile

Invoke `/file-sorting`'s **detect-profile** on the connected folder (or the folder argument). If no folder is connected, or it matches no profile, offer a picker (`mcp__cowork__request_cowork_directory` with no `path`), re-run detect-profile, and if it still matches nothing, say so and ask; never guess a profile.

**On any Kind other than `rename-in-place`, print one line and end:** "This is the accounting root. /housekeeping handles litigation matters only; use /route-accounting for it." No hand-off: the Skill tool refuses a skill that carries `disable-model-invocation`.

Then invoke `/file-sorting`'s **scope** for the root: the folder-type keyword table with each type's notes file, the always-skip rules, the disambiguation tips, the verbatim-path rule, the argument rule, the extension whitelist, the name-gate second pass and the Law folder's flag tokens. Record each matched folder's on-disk name verbatim and reuse it everywhere. Two type-4 folders (an old `4 LAWYER BRIEF` beside `4. LAWYER BRIEF`) are both swept and both offered, by their on-disk names. This flow writes no `hashes.json` or `rename-plan.json`: its run files are the run directory's, written by the server.

## Step 3 — Half-commit check

Call `housekeeping__preflight` (`matter_root`). A non-empty `half_commit` means a write to this matter's case database was cut off inside its commit to disk. Then **write nothing**: stop the run and hand the state to the practitioner, naming each path in `half_commit`, with the `case_data__execute` timeout advice: the case databases may be a mix of new and previous state, nothing is written to them until they are reconciled, and each listed folder is deleted once they are. A `case_data_found` of false is not a halt here; Step 4 deals with a missing case database. A matter folder with no pointer (neither `probanda.json` nor `coclerk.json`, or only a legacy `9. AI` pointer) is not an error either: `housekeeping__preflight` returns an empty `half_commit` and `case_data_found` false, and the run goes on to Step 4, which offers to set the case database up.

Repeat this check, a fresh `housekeeping__preflight` call, before every write phase (Step 5's recovery, Step 9's ingest, Step 15's apply, and an answered-question or It's-final ingest at apply).

## Step 4 — Case database and schema

Follow the profile's **record-backend** protocol: invoke `/case-data`, ask whether the matter has a case database, run its `pointer-health`, and show the result as its one line.

- **A schema-version failure** (the case database is older than this build needs): halt the whole run and say so in chat. Nothing is ingested against an old schema, and no page is built. Name the fix: `/case-data`'s migrate operation, run through its `migration-runner` agent.
- **No case database:** this flow cannot run without one, because every file it files is read into the case database and its review log lives there. Of the profile's two options, offer only **set up the case database now**. If it is set up, give the profile's verbatim message and end the run. If it is declined, end the run.
- **A stale pointer, or the `case_data__*` tools absent:** halt and name the error.

## Step 5 — Finish interrupted approvals

Run **Recovery** (below) for every interrupted run of this matter before building anything. Rows it finishes take no place in this run's 50. Keep its summary for the page header, for example "Finished 16 files you approved on 23 Sep. 2 could not be finished and are shown below."

## Step 6 — Build the candidate list

First call `housekeeping__new_run` (`matter_root`) for this run's `run_id`. The new run directory stops every earlier page from approving, so the previous run that Step 7's order rotates against cannot change under this run. A run that stops before Step 13 leaves its directory without a `proposal.json`; later runs read past it.

List the root of `matter_folder`, not recursively.

- **Never a candidate, never mentioned:** any file or folder whose name starts with `~` or `.`; at the root, `probanda.json`, `CLAUDE.md`, `AGENTS.md`, `ProceduralHistory.md`, CaseMap files (`.cm12`, `.cm14` and every other `.cm*` extension), `desktop.ini`, `.lnk` shortcuts, and hidden or system files; the root folders `TRASH` and `Claude outputs`.
- **Open in Word.** A root file is open when a sibling `~$` file has the same extension and a stem equal to the file's stem with 0, 1 or 2 leading characters removed. It is not read, rowed or counted. List its name for the header line "Open in Word, skipped this run".
- **Root folders.** Folders numbered 0 or 1 are neither swept nor listed (they are never destinations either, except `0. DRAFT` on a `draft` row; `0. DRAFT\Superseded` is case-data's own destination for a superseded version, never housekeeping's). A folder the keyword table matches is swept. Any other root folder is never looked inside, and its name goes on the header line "Folders not looked inside".
- **Root files:** every other root file is a candidate, whatever its extension.
- **Subfolder files:** every file with a whitelisted extension (`.pdf .docx .doc .eml .msg .xls`, per the profile; `.xlsx` is not on it) anywhere inside a swept folder, skipping `~`- and `.`-prefixed names at every level. Research downloads filed straight into a `6. LAW` issue folder are subfolder files, picked up where they sit.

Apply the argument (above) to this list.

**Hash every candidate once**, in one call: `/file-apply`'s `../file-apply/scripts/hash_files.py --files <path> ...` (in Cowork it sits in the installed `file-manager` plugin's `file-apply` skill folder). A file in its `errors` is left out of the run and named in the report with the error. Hashing a cloud-only file (one the folder's sync client holds only online) downloads it.

**Name gate over every subfolder candidate's current name**, one call of `/file-naming`'s **gate** intent, passing the Law folder's flag tokens for names in a Law folder (materialize `code-registry.md` from `skill_source__read` to a temp file when the registry is not on disk). Then run the profile's second pass over the failures in folders with alternate whole-name formats (Law, Discovery): a match with its notes' format **conforms**. A Law name whose gate result carries a flag token does not conform.

**Review-log lookup:** one `/case-data` `housekeeping-log` `lookup` over every candidate's `{file_name, file_hash}`. Per candidate it returns whether a settled verdict matches (`reviewed`), whether a `not_ingested` row matches by hash, and any remembered ingest failure (`ingest_failure`, with its reason and whether the next run retries it automatically).

The order of the candidates is not decided here, and no earlier run directory is read: Step 7's `housekeeping__order_candidates` computes the order, with rotation, from the admitted files.

## Step 7 — Ingest status, then admit, order and cap

One `/case-data` `ingest-status` call over every candidate, in path order: `matter_root`, `matter_folder`, and `{path, hash}` per file. Per file it returns a verdict (`ingested`, `ingested_by_reference`, `superseded`, `partial`, `failed`, `none`), the store, source ids, the stored path, `moved`, `duplicate_of` with `twin_ingested`, `pending` markers, and the stored `metadata`. A file counts as **ingested** when its verdict is `ingested`, `ingested_by_reference` or `superseded` (an earlier version of a court document case data holds); verification is not required. A `duplicate_of` file is a **duplicate** (the later of two identical files, or a copy of a file still at its stored path): never ingested, never re-pointed. Keep `ingest-status`'s pick of which copy is the duplicate; never swap it, even when the other copy is already filed. A `moved` file was moved by hand: it is ingested, and `relocate-source` repairs its stored path when it is filed.

**Admission:**

- **Root file:** always admitted. The review log is never consulted for admission.
- **Subfolder file:** admitted when **(its name does not conform (Step 6) AND no settled verdict matches it)** OR **(it is not ingested AND no `not_ingested` row matches its hash)**. `--force` drops the settled-verdict condition from the first arm only.
- A file finished by Step 5 is not admitted this run.

**Order and cap: 50.** Make one `housekeeping__order_candidates` call (`matter_root`, `run_id`, and every admitted file as `{path, hash}` in stored form). It orders them fresh root, fresh subfolder, rotated root, rotated subfolder, where a file is rotated when the previous run's page offered it and it was not approved there (left as is, `stuck` or `misfiled`), and caps them at 50. Rotation changes order only, never admission. Its `admitted` list, in its order, is this run's rows, read or not: only these files go on to Step 8 and Step 9. Its `deferred` list is the `deferred` rows: each is recorded in `proposal.json` for the count and nothing else happens to it. Never reorder, trim or extend either list: `housekeeping__write_run_file` refuses a `proposal.json` whose rows break the order or the cap.

## Step 8 — Page-1 routing read

First ask `/case-data` for the matter's filing lawyer and firm, client name, party names and every proceeding's court file number. The firm-draft check below and Step 11 use them.

For each row that **needs ingest** (not ingested, not a duplicate, a kind ingest reads, and not a remembered ingest failure that is not due its automatic retry), read page 1 inline, in this session. For `.eml`, `.msg` and `.docx`, page 1 is the head of the rendering, staged first in a bridged session. Kinds ingest reads: `.pdf`, `.docx`, `.eml`, `.msg`, and an RTF `.doc` (it begins `{\rtf`) as an authority. A `.msg` that fails to render is a deterministic ingest failure that `ingest-unattended` records, not a kind ingest cannot read. Every other kind (`.xls`, a non-RTF `.doc`, images, and any other root kind) is not attempted: it becomes a "Could not read" row. An image can still be looked at; build its evidence from what it shows so it gets a proposed name.

From each page-1 read, record the routing (an internal document such as a client email, a lawyer's note or a memo goes to the privileged store; an authority; any other document) and the facets of a naming-evidence block (Step 10), including `filing_stamp` and `signature`, which always come from this read, and `transmission` when page 1 prints a delivery line ("By Email", "Via Fax and Email").

**Firm drafts, root files only.** For every root document read here, record four facts from page 1, each with its quote or the word `absent`:

- `firm_authored`: the author side is the firm acting for this matter. The letterhead, signature block or "Solicitors for" line names the matter's recorded filing lawyer or firm, or, when none is recorded, a lawyer or firm the document itself shows acting for the matter's client ("we act for", "our client", "Our File"); or it is a court document whose filing party is the client. Never decided from the practitioner's own firm profile.
- `draft_marking`: the words DRAFT, "for discussion", "not sent", or a version tag.
- `signature`: a signed signature line. A blank "Per:" line or an unsigned name block is `absent`. The naming-evidence `signature` facet from this read follows the same rule.
- `sent_or_filed`: evidence the document went out: an email header or sent-items print, a filing stamp, or a served-on or received stamp. A typed transmission line ("By email") or a typed date alone is not this evidence, because drafts carry them before anything is sent. The `transmission` facet records that typed line for naming only, and this check never reads it.

Flag "Looks like your unfinished draft" when `firm_authored` is present and either `draft_marking` is present or both `signature` and `sent_or_filed` are `absent`. A served but unfiled copy from the other side is a record, not a draft (`firm_authored` absent). Keep the four facts, the absent ones included ("no signature, no sent date"), as this session's evidence for choosing the row's action. A flagged file is left out of this run's ingest.

## Step 9 — Ingest

Repeat the half-commit check (`housekeeping__preflight`). Then make **one** `/case-data` `ingest-unattended` call with the explicit capped list: every row that needs ingest (Step 8) except flagged drafts, in row order, each `{path, hash, folder_type}` (`folder_type` the keyword table's type name for the folder holding the file, such as `Correspondence`, `Law` or `Court File`; null at the root). Never a folder walk, and never two calls on one matter at once. The call writes each document in its own transaction, in list order, never several documents in one write. It reuses this session's page-1 reads, asks nothing, ingests an internal document into the privileged store by default, writes the pending markers for order effects and linkage instead of running those passes, and records every failure in the review log itself, with whether the next run retries it (an extractor failure the first time: yes; a deterministic failure, or any later failure: no).

Per file it returns `outcome` (`ingested`, `ingested_by_reference`, `partial`, `stopped`, `failed`, `not_ingested`), store, source ids, the stored path as written, `pending`, `stop` (the question and its options), `failure` (class and reason), `notes`, `naming_evidence` and `naming_evidence_defect`. Keep every `stop` for Step 13's `questions.json`.

Then make one more `ingest-status` call over the files ingested in this step: its `metadata` is the ingest record Step 12 cross-checks the proposal against.

## Step 10 — Naming evidence and gap-fill reads

Each facet of a naming-evidence block carries a verbatim quote and a pinpoint, or is absent: `title`; `dates[]` with kind (created, signed, sworn, filed stamp, sent, decision, other); `author`; `recipients[]` with capacity; `style_of_cause`; `court_registry`; `action_number`; `affidavit_number`; `filing_stamp`; `signature`; `operative_language` (serves, encloses, neither); `transmission` (printed delivery methods, in printed order); `attachments_referenced[]`; `amounts[]`; `contradictions[]` (paired quotes); `other_matter_signals[]`; `readability`; `pages_read`. Each row's block comes from:

- **Ingested this run, extractor block returned:** that block, plus `filing_stamp` and `signature` from the Step 8 read. An affidavit's first pass stops at page 20, so a long affidavit's sworn date can be missing; the care row says why.
- **Ingested this run with no extractor block** (an internal document read inline, a compound book, a book of authorities): build it from the read this session made during the ingest, including `transmission` when a page read prints a delivery line.
- **A defective block** (`naming_evidence_defect`): build the block from the stored record, as below, and give the row the signal "The reader returned an unusable report" (signal `uncertain_name`). Report it as a defect. The document's write stands.
- **Already ingested before this run:** not re-read. Build the block from `ingest-status`'s `metadata`, each facet pinpointed to its stored field (`stored:date`): a main record's title, description, category, date, execution status, filing party and proceeding; a privileged record's title, category, author, recipient and date; an authority's title, citation and type, under the Law folder's naming rules. **Gap-fill read:** before the first namer dispatch, read page 1 inline (the head of the rendering for `.eml`, `.msg` and `.docx`) when the stored record has no date, is a main-store record of category correspondence or work product, has an empty title, is a main-store email attachment (no stored path, so its title is only the attachment's file name), or is a privileged-store record of category `privileged_correspondence` or `solicitor_client` whose file is a `.pdf` (a privileged `.eml` or `.msg` is not read for this reason, since its `E`-first code ignores the facet), and add the facets it shows, `transmission` among them when page 1 prints a delivery line. A component still missing sends the row to care, and its reason line says only page 1 was read.
- **Not ingested, with a Step 8 read** (drafts, stopped files, files that failed this run, images): the Step 8 block.
- **Could not read, or held back by a remembered failure:** no block, no proposal.

## Step 11 — Compose

**What is composed.** Every admitted row with a block, except privileged-store rows, which this session composes itself (below). A subfolder row admitted only by the ingest arm, whose name conforms, still goes to the namer, so its folder's misfile test runs (a misfiled file is caught even when its name is fine); its proposal stays its current name unless the namer raises `misfiled`. A duplicate is composed from its twin's stored record (the `metadata` `ingest-status` returned with it); with none, its proposal is the twin's own name and folder.

**The namer.** The matter's party names and court file numbers are the ones fetched at the start of Step 8. Split the namer's rows into batches of about 15 and dispatch every batch **in one turn**, in parallel: Agent tool, `subagent_type: "file-manager:housekeeping-namer"`, `model: "sonnet"`. If that agent type is not in this session's roster, stop and say so; no other agent composes names. Each dispatch carries one JSON object:

- `run_date`; `matter`: `root_name`, `parties`, `action_numbers`;
- `folders`: each on-disk filing folder (never 0 or 1, never `TRASH`), `{name, folder_type, subfolders}` with `folder_type` the keyword table's number and `subfolders` the relative paths of the folders inside it;
- `rows`: `{row_id, current_name, location (root | subfolder), containing_folder, store (main | law; a not-yet-ingested row takes the store its Step 8 routing points to), evidence_source (extractor for a block from a read made this run, stored_row, or stored_row_plus_page_1 after a gap-fill read), naming_evidence, attachments_present, notes}`. `attachments_present` lists the attachments confirmed present in the file (an affidavit's exhibits found by ingest), and is left out when there is no inventory to check against.

It returns one entry per row, in order: `proposed_name`, `name_confidence` (`ready` or `best_guess`), `doubtful_components`, `components` (each with value, status and facets), `destination` (`status` chosen, ambiguous or none; `folder`, `folder_type`, `exists`, `subpath`, `new_folder`, `candidates`), 2 to 4 `alternatives`, `flags` (`rule_gap` with its three escape-log pieces and reference file, `missing_attachment`, `contradiction`, `other_matter`, `unreadable`, `misfiled` with its proposed folder), and a one-sentence `reason`. A batch whose return is not one well-formed entry per row is re-dispatched once. If it fails again, its rows are `stuck` with the reason "the name could not be composed this run".

**Privileged rows, composed here.** Never send one to the namer. Fetch the same references it uses (`/file-naming`'s `general-conventions.md`, `code-registry.md`, `conformance-check.md` proposal mode; the profile and the candidate folders' notes) and follow the same procedure. For a root file: pick the code first from the registry and general conventions, map it through the registry's "Typical folders" column onto this matter's folders, read only those folders' notes, apply their "Misfile test" sections in reverse to narrow to one destination, then let that folder's notes govern the name. For a subfolder file: its containing folder's notes apply, and its misfile test, run forward, may raise `misfiled` with a proposed move. Produce the same report shape: components with statuses, flags, 2 to 4 alternatives, a reason.

**Rules the namer and this session share.** No code: No naming rule fits. A code but no candidate folder: no destination (Folder unclear). Two court-file folders: the `action_number` decides; none readable makes the destination ambiguous. A document with no date takes `0000-00-00` (or `0000-MM-DD`) and needs no signal when the whole document was read; only a date not established within the read is a signal. A numeric date that reads as two different dates (day and month both 12 or under and unequal, as in `03/04/26`) is not established unless another part of the document fixes the order; a stored-record date never does, since an earlier reader chose it from the same numeric date. The candidates for a root file are only the folder types the code's "Typical folders" column lists, a transmittal filed by its own code and never by what it carries; a typical folder missing on disk is a candidate like one that exists, never dropped for not existing, and is proposed by its folder type (Step 12 names it from the template). The namer's best guess on a care row, with its doubtful token marked, is this session's evidence only: a guessed name is never proposed. Codes are never minted: a document type with no code is a `rule_gap`. The delivery code of a `.pdf` letter is the registry code that describes the `transmission` facet's methods in printed order, under the code registry's order-of-sending rule, and is `inferred`, so the row stays eligible for `ready`. A `.eml` or `.msg` keeps its `E`-first code whatever the facet says, an incoming letter with no facet stays `LF`, and printed methods that no registry code describes are a `rule_gap`.

## Step 12 — Rows: checks, signals and precomputes

Build every row from Steps 7 to 11, using **Rows** (below) for its section, its signals and its one action. Then run these on every row:

**Destinations.**

- Destinations are the filing folders and any folder inside them; never folders 0 or 1 or anything inside them, and never `TRASH`. The one exception is `0. DRAFT` on a `draft` row. `0. DRAFT\Superseded` is case-data's own destination for a superseded version of a court document, and no row proposes it.
- A folder counts as present when an on-disk name matches ignoring case and a trailing plural (`9. DISBURSEMENTS` = `9. DISBURSEMENTs`). Use the on-disk name.
- **Template.** The firm's standard folders are the template tree that `/file-sorting`'s litigation-matter profile names, every subfolder included; no skill keeps a copy, and this session lists it only through `housekeeping__preflight`. Read it only when some proposed destination is missing in the matter, once per run while the page is built: one `housekeeping__preflight` call with `include_template: true`, whose `template_folders` lists every template folder, every level, template-relative. A `template_missing` failure stops the run before the page is built: report the path it names. A proposed missing folder takes the name of the template folder of its folder type (by the keyword table), whatever spelling the namer gave it. When the template was read, `proposal.json`'s folder list also carries every missing template folder with `exists: false`, which may then be proposed and is created on apply, except folders 0 and 1, `TRASH`, a `Party #N` placeholder and the bare `5. COURT FILE#` stem. When it was not read, the list holds on-disk filing folders only.
- **Court file.** Compare a document's action number with the existing court-file folders ignoring spaces, hyphens, "No." and the registry name. With no match, propose a new folder named in the existing folders' form (`5. COURT FILE#S-290001`); it is created on apply. No readable number: the destination is ambiguous.
- **Placeholders.** A template `Party #1` or `Party #2` folder is never created by that name: the actual party's name takes its place as a non-standard folder (`7. DISCOVERY\LOD Plaintiff\Jane Smith`). A party name used as a folder drops a trailing period (`Plaintiff Holdings Inc`), and no folder or file name ends in a dot or a space.
- **A non-standard folder** (not in the template) is proposed only inside a numbered folder, never directly under the root, and its action sets `create_folder: true`, so Approve creates it. A missing folder directly under the root that is not in the template is never proposed: the row loses its destination (`folder_unclear`), and is `stuck` unless another folder fits.

**Deterministic checks (every row, whatever the reader said).**

1. **Name gate** on the proposal, with the destination's flag tokens and the profile's second pass. A failing proposal is a signal.
2. **Collision.** Two rows proposing the same name for the same folder, or a file of the proposed name already in the destination, is a signal on each row concerned.
3. **Cross-check** each row ingested this run against its ingest record (Step 9's second `ingest-status`): the proposed name's date, code family and parties must agree with the stored date, category and parties. A disagreement is a Contradicts itself signal quoting both. This catches a reader that contradicts itself; it does not check truth.
4. **A malformed reader report** is the Step 10 defect.

**Precomputes (`name_checks`).** For each row with a proposed name, check it against its one destination: that folder's name check (the gate with that folder's flag tokens, and the second pass for Law's citation and AI-memo forms and Discovery's listed-document form), and whether a file of that name is already there. Record the pair when it passes only through a folder's second pass. A name that raises one of the destination folder's flag tokens fails that folder's check even when it matches a second-pass format, and is never recorded `ok`. A name that fails, or clashes, is never proposed: pick another name or folder, or make the row `stuck` ("possible duplicate of <path>" for a clash). When the current name already passes the check for the destination, the row keeps it: `move` when the file needs another folder, `ingested_only` when it needs nothing.

**Rule gaps.** Every `rule_gap` becomes one `rule_gaps` entry: `run_date`, `matter_root` (each entry carries its own, so gaps can be read across matters), `file_name`, `trigger`, `current_rule`, `missing` (the three escape-log pieces), `reference_file`, `best_guess`. A rule-gap row is `stuck`, its reason naming the gap ("no naming rule for a bill of costs"); nobody acts on the gap in the run.

## Step 13 — Write `proposal.json` and serve the page

Write `proposal.json` into this run (Step 6's `run_id`) with `housekeeping__write_run_file`; it must validate, keep Step 7's order and cap (`proposal_out_of_order` names the first row out of place), and is write-once, so build it whole first. Its shape:

- `run_id`, `matter_root` (the host path), `created_at` (ISO timestamp);
- `header`: `open_in_word`, `folders_not_looked_inside` (names), and `finished_line` from Step 5 when it has one;
- `folders`: `{path, exists, flag_tokens?, second_pass?}` for each filing folder (Step 12's list), `flag_tokens` on the Law folder, `second_pass: true` on Law and Discovery;
- `draft_folder`: the on-disk `0. DRAFT*` folder, or null;
- `rows`: `{row_id, current_path, hash, ingest_outcome, store?, source_ids, section, action?, name_checks, notes, twin?}` in `housekeeping__order_candidates`' order, its `admitted` files then its `deferred` ones, `row_id` short and unique (`r001`), arrays empty where there is nothing. `section` is `offered`, `ingested_only` or `deferred`; `action` (**Rows**) is present exactly on `offered` rows. `twin` is `{path, row_id?, ingested}`; its `row_id` is required when the twin is itself a row on the page. `ingest_outcome` is the file's state as the page is built (`ingest-unattended`'s `not_ingested` is `none`). Signals, reasons and evidence are this session's working and are not written: the page shows none of them;
- `rule_gaps` (Step 12).

When any row's action carries an `answer`, also write `questions.json`: per row id, the `stop_reason` and the options as `{value, label}`. The action's `answer` is the label this session picked; apply maps it back to its value.

Then call `housekeeping__serve_page`. Serving invalidates every earlier page for this matter. Give the practitioner the `url` ("Ctrl+click to open it in Chrome"), and the three counts: to decide (not counting `stuck` and `misfiled` rows), ingested with nothing to approve, left for the next run.

## Step 14 — Wait for Approve

Call `housekeeping__wait_approval` and re-issue it on every `pending` (the page's Submit writes the approval). The page shows every row with a radio pair, **Approve** and **Leave as is**, starting on Leave as is, except `stuck` and `misfiled` rows, which it shows for information only (no radio pair, no group box, not counted); Submit posts one `approve` entry per approved row and nothing for a row left as is, and the server refuses an entry on a `stuck` or `misfiled` row. On `approved`, go to Step 15; an approval with no rows is valid, applies nothing, and goes on to Step 16's report. On `invalidated`, a newer run for this matter has started: stop without applying and say so. On `corrupt`, `approval.json` is there but cannot be read: tell the practitioner, naming the `file` and its `problem`, and apply nothing. If the practitioner says "done", call it once more. If they say to stop, end the run without applying anything. Closing the tab is not an action; the link works while this run is live.

## Step 15 — Apply

Everything here is read back from disk, never from memory: `housekeeping__resolve` (`matter_root`, `run_id`) resolves each approved row (every `approval.json` entry is `approve`; a row left as is has no entry and is not resolved) from `proposal.json` and `approval.json` into its `kind`, `move`, `old_path`, `new_path`, `name`, `folder`, `folders_to_create`, `answer`, apply-time `checks` (name gate, destination clash, folder present or creatable from the template), `ok` and `failure`, and any journal line already written. A row's hash, store and current path come from its `proposal.json` row, read from the run directory. Nothing that is not in both files is applied. If `housekeeping__resolve` fails `approval_corrupt`, the saved approval cannot be read: tell the practitioner, naming the file its message gives, and apply nothing. Repeat the half-commit check (`housekeeping__preflight`) first. After a compaction, call `housekeeping__reconcile` with this `run_id` and continue from its answer (**Recovery**).

**Row by row, in the order `housekeeping__resolve` returns them, every row except trash rows:**

- **Already journalled:** skip it.
- **`invalid`:** journal `failed` with its failure; report it.
- **`retry`:** collect its hash. After the loop, one `housekeeping-log` `retry` call with every retry hash. No move, no journal line.
- **Not `ok`:** when `checks.name.verdict` is `second_pass_required` and the clash and folder checks passed, run the chosen folder's second pass on the name; a pass makes the row ok. Otherwise the file stays where it is: journal `failed` with the failure, and it is re-proposed next run. No code is ever registered in a run.
- **`answered_question` and `final`:** repeat the half-commit check (`housekeeping__preflight`), then run `ingest-unattended` on this one file (`answer: {stop_reason, choice}` from `questions.json` for an answered question, the choice being the value whose label is the row's `answer`; a label not found there journals `failed`; none for It's final). Ingested: continue with its steps, taking the store from this ingest. Otherwise the file stays untouched: journal `failed` with the reason; it reappears next run.
- **Every other `ok` row:** run the steps its kind names (**Row kinds at apply**, below), in this order, then journal. A row without `move` skips step 4 and writes no journal line.
  4. **Move:** `file_ops__move` with `matter_root`, `source` = `old_path`, `destination` = `new_path`, `create_folders` = `folders_to_create`, and `draft_unchanged: true` for `draft_unchanged`. `moved_to` must equal `new_path`: on a mismatch, halt the apply and report. `dest_exists` or any other refusal (a locked file included): journal `failed` with it; the file is re-proposed next run. `not_found` (the source has gone): do not journal; call `housekeeping__reconcile` with `run_id` and act on this row's state.
  5. **`/case-data` `relocate-source`:** `hash`, `store`, `old_path` and `new_path` in stored form.
  6. **`/drafting-data` re-point** of its stored document paths from `old_path` to `new_path`, stored form. Zero rows is normal; a matter with no submission database has nothing to re-point. When the `drafting-data` skill is not available in this session, the `litigator` plugin is not installed and no matter has a submission database: skip this step.
  7. **Review log** `housekeeping-log` `record`, one entry: `file_name` the new basename, `file_hash` unchanged, `folder_type` the destination folder's type name, `outcome` per kind.
  8. **Manifest:** for a file renamed inside a `6. LAW` folder whose `case-download-manifest.json` names the old file name, `research_filing__append_manifest` into that folder with `{event: "renamed", from, to, hash}`.
  
  Then `housekeeping__journal_append` `done`. Steps 5 to 8 are each safe to run twice. A failure in any of them is reported and journalled `failed` with its reason (the step and its error), so no row is left without a journal line once its failure is reported.

**Trash rows, after every other row.** For each, call `housekeeping__reconcile` with `run_id` immediately before it: it checks that the file still holds the approved hash and that its twin still exists with the same hash, at its pre-run path or where its own row moved it. Action `trash`: `file_ops__trash` on `old_path` (a soft delete into `<root>\TRASH\<same relative path>`), then journal `done`. `journal_failed`: journal `failed` with its reason and report; the next run re-derives the row. `journal_done`: journal `done`. A trash row writes no review-log row.

**Rule gaps.** After the apply, write `rule_gaps.json` with `housekeeping__write_run_file`: every `rule_gaps` entry with its `outcome` filled in, always "left where it is" (a rule-gap row is `stuck`, which is information only).

## Step 16 — Report

In chat: what was renamed and filed, what was filed without ingest, moved to `0. DRAFT` or moved to `TRASH`; what was skipped or failed and why (a destination clash as "possible duplicate of <path>"); any defect; the deferred count with an invitation to run `/housekeeping` again; and "N naming-rule gaps recorded for the convention maintainer" when `rule_gaps` is non-empty. For every `misfiled` row, name the matter and say that housekeeping never moves a file between matters: the practitioner moves it into that matter's main folder, and its next run reads and files it. List every `stuck` row once with its reason, apart from the left-as-is count.

**Leave as is.** Then give the number of files left as is (offered rows other than `stuck` and `misfiled` with no `approval.json` entry), and say that any of them can be named in this chat to rename it, move it, or have housekeeping leave it alone for good. Ask nothing about them. When the practitioner names one, carry out the instruction in this chat as an ordinary instruction: a rename or move goes through a fresh `housekeeping__preflight`, the name gate and the destination folder's check on any new name, then `file_ops__move` and Step 15's steps 5 to 8 for the matching kind. No approval page is involved. These moves sit outside the run's journal, so an interruption leaves the file wherever it is and the next run re-derives it. "Leave it alone for good" on a subfolder file is one `/case-data` `housekeeping-log` `record` entry, `outcome` `manual_review`, under its current name and hash. A file left as is and not named needs nothing: it is offered again next run.

---

## Recovery

An **interrupted run** is a run directory holding `approval.json` in which some move row has no journal line. A run directory with `proposal.json` and no `approval.json` is a page closed without Approve: it is finished, not interrupted, and its rows come back through the usual admission and rotate.

Call `housekeeping__reconcile` with `matter_root` and no `run_id` (Step 5), or with the live `run_id` after a compaction. It hashes each open row's old and new paths, re-runs the apply-time checks, and returns per row a `state` and an `action`. It moves and journals nothing itself. If it fails `approval_corrupt`, a run's saved approval cannot be read: stop, tell the practitioner, naming the file its message gives, and apply nothing. Act on each row, trash rows last:

| Action | Do |
|---|---|
| `apply` (not moved, checks pass) | Step 15's steps for the row's kind, then journal `done`. When `resolution.checks.name.verdict` is `second_pass_required`, run the folder's second pass first; a fail is journalled `failed` |
| `needs_ingest_status` (an answered-question or It's-final row not moved) | `ingest-status` for the file. Ingested: continue at step 4. Otherwise run `ingest-unattended` for it first (with the answer from that run's `questions.json`), then step 4 |
| `post_move_steps` (the file is at its new path: the apply stopped after the move, before any journal line) | the kind's steps after the move (5 to 8), replayed whole, then journal `done`. A failure in one of them is reported and journalled `failed` with its reason, as in Step 15 |
| `trash` | `file_ops__trash`, then journal `done` |
| `journal_done` | journal `done` |
| `journal_failed` | journal `failed` with its `reason` and report it. "Changed since approval", "approved file not found", a clash, "duplicate at destination": the file is left as it is and comes back as an ordinary candidate (a duplicate as a Duplicate row) |

A move error is not a verdict: when a move fails because the source has gone, reconcile again and act on the row's new state. Repeat the half-commit check (`housekeeping__preflight`) before any recovery write.

---

## Rows

**Sections.** `offered`: every admitted, capped row that needs a decision, with one `action`. `ingested_only`: a subfolder file ingested this run whose name conforms and that carries no signal, shown collapsed as "Ingested, nothing to approve" with notes such as "stored as privileged". `deferred`: past the cap. A subfolder row that was not composed (it could not be read), or whose conforming name the namer kept without raising `misfiled`, keeps its own folder as its destination.

**Signals.** A row carrying any signal is a care row: weigh every signal it carries before choosing its one action, and never propose a guess. The signals, by the name this session uses for them:

| Signal (this session's name) | Signals | Produced by |
|---|---|---|
| `another_matter` Appears to belong to another matter | 8, appears to belong to another client matter | namer `other_matter` |
| `duplicate` Duplicate | 4, same contents as another file, by hash (not an authority second copy) | `ingest-status` `duplicate_of`; recovery's "duplicate at destination" |
| `could_not_read` Could not read | 7, unreadable or corrupt; 10, ingest failed (stored reason) or a kind ingest cannot read | namer `unreadable`; Step 8; `ingest-unattended` `failed` or `not_ingested`; review-log `ingest_failure` |
| `draft` Looks like your unfinished draft | 14 | Step 8 |
| `question` Reading stopped on a question | 10, stopped | `ingest-unattended` `stopped` |
| `partial` Reading not finished | 10, partial | verdict or outcome `partial` |
| `follow_up` Waiting on a follow-up step | 10, order-effects, linkage or date-anchor pending | `pending` markers |
| `authority_copy` Second copy of a case or statute | 10, authority second copy, or a suspected authority duplicate reported for merge | `ingested_by_reference` from store `law`; `ingest-unattended` notes |
| `attachment_copy` Copy of an email attachment already read | 10, attachment copy | `ingested_by_reference` from store `main` |
| `contradiction` Contradicts itself | 5 | namer `contradiction`; Step 12 cross-check |
| `missing_attachments` Missing attachments | 3 | namer `missing_attachment` |
| `no_rule` No naming rule fits | 1, no code or an ambiguous rule | namer `rule_gap`, or no code |
| `uncertain_name` Part of the name is uncertain | 2, a component not established | namer `best_guess` with doubtful components; gap-fill leftovers; a defective reader report |
| `wrong_folder` Filed in the wrong folder | 11, a subfolder file that belongs elsewhere in the matter, with the proposed move | namer `misfiled` |
| `folder_unclear` Folder unclear | 12, ambiguous destination | namer destination `ambiguous`, or `none` with a code; no readable action number; a proposed folder that may not be created |
| `name_taken` Name already taken | 9, collides with another row's proposal or a file in the destination | Step 12 collision and clash checks |
| `name_check` Name does not pass the naming check | 6, the proposal fails the name gate; 13, the name check fails or a flag token is raised for the proposed folder | Step 12 gate and precomputes |

Not signals: "Stored as privileged" and "Attachments not recorded" (unregistered `.eml` attachments) are notes on an `ingested_only` row; gaps in a complete read are not recorded.

**The one action** (`action`; the page shows it as one line with the radio pair Approve and Leave as is, starting on Leave as is, grouped by `kind` in this order; a `misfiled` or `stuck` row is shown for information only, with no radio pair):

| `kind` | Fields | Propose it for |
|---|---|---|
| `file` | `name`, `folder`, optional `create_folder`, and at most one of `file_no_ingest`, `final`, `answer` | a root file, or a subfolder file misfiled within the matter, with a new name |
| `rename` | `name`, optional `file_no_ingest` | a subfolder file renamed in its own folder (a root file never) |
| `move` | `folder`, the same options as `file` | the same as `file`, keeping the current name (it conforms, or the file is filed without reading under it) |
| `draft` | none | a root file only: a flagged firm draft, or a kind ingest cannot read, moved to `0. DRAFT` under its name |
| `duplicate` | none (the row carries `twin`) | a non-authority duplicate, moved to `TRASH` |
| `misfiled` | `matter` | a file that appears to belong to another client matter. Information only: nothing is approved on it |
| `unreadable` | none | a failed ingest (`ingest_outcome` `failed`): try once more next run |
| `stuck` | `reason`, one short phrase | no proposal is possible. Information only, under "Left where they are" |

Choose one action per row. Where the old page offered alternatives, decide:

- **Could not read, failed ingest:** `unreadable`, unless the failure is deterministic and will not change, when file it without reading (`file_no_ingest`) or make it `stuck`.
- **Could not read, a kind ingest cannot read:** `file`/`move` with `file_no_ingest` (a name from what an image shows, else the current name), `draft` for a root file of a non-whitelisted kind, or `stuck`. A subfolder file filed without reading stays in its folder (`rename`, or `move` to its own folder).
- **Draft (root):** `draft`, unless the evidence shows the document final, when `file` with `final: true`.
- **Question:** pick the option the evidence best supports as `answer` on a `file` or `move` row; if none is supported, `stuck`.
- **Duplicate:** `duplicate`. Keep both (`file`/`rename`/`move` with `file_no_ingest`) only when the twin is ingested and the name does not clash with it.
- **Another matter:** `misfiled` with the matter's code or name.
- **Folder unclear:** pick the folder the evidence supports (a court file by action number); none: `stuck`.
- **Partial, a suspected authority duplicate reported for merge, any path holding a `privileged` or `disclosed` folder, no naming rule, contradictions or a component not established:** `stuck`, with the reason ("reading not finished; the next run carries on", "possible second copy of an authority; resolve with /case-data first", "in a privileged folder, which housekeeping never moves", "no naming rule for a bill of costs", "heading and jurat name different deponents").
- **Everything else carrying signals (follow-up pending, authority second copy, attachment copy, misfiled within the matter, name taken, name check):** propose the move or rename when a clean name and folder exist, else `stuck`.

An order-effects, linkage or date-anchor row is filed normally: it is shown in the run that ingests the file, and once filed it is not re-admitted while the marker stays for its follow-up step. An authority second copy and a copy of an email attachment already read are both filed as ingested by reference.

## Row kinds at apply

| Kind (`housekeeping__resolve`) | Steps | Review log | Journal |
|---|---|---|---|
| `rename_and_file`, `rename_in_place` (a `file`, `rename` or `move` row) | 4, 5, 6, 7, 8 | `renamed` | yes |
| `answered_question`, `final` | ingest first, then 4, 5, 6, 7, 8 | `renamed` | yes |
| `ingested_by_reference` | 4, 7, 8 | `renamed` | yes |
| `file_no_ingest` | 4 when the path changes, 7; a subfolder file stays in its folder | `not_ingested` | when it moves |
| `draft_unchanged` | 4, under the current name; a clash leaves it at the root | none | yes |
| `retry` | review log `retry` only | (retry) | no |
| `trash` | `file_ops__trash`, after every other row | none | yes |

## The review log

Every applied row that moves or files a file writes one review-log row in its post-move order, except `draft_unchanged` (none, so a draft can still be ingested if it is later filed unchanged). A row left as is writes nothing: the file is offered again. `renamed` and `manual_review` (written only from a Step 16 chat answer) settle a subfolder file's name; `not_ingested` settles its name and stops the ingest arm by hash; an ingest failure is recorded by `ingest-unattended` itself, settles nothing, and only schedules retries and supplies the care row's reason. A rename that was approved but failed is not recorded, and the row comes back next run.
