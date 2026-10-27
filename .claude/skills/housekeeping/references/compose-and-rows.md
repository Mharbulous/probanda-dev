Read when: composing names and destinations (Step 11), building rows and running their checks (Step 12), or choosing a row's section, signals or one action (**Rows**, which Steps 13 and 14 also use) in `/housekeeping`.

# Housekeeping: compose and rows

## Step 11 — Compose

**What is composed.** Every admitted row with a block, except privileged-store rows, which this session composes itself (below). A subfolder row admitted only by the ingest arm, whose name conforms, still goes to the namer, so its folder's misfile test runs (a misfiled file is caught even when its name is fine); its proposal stays its current name unless the namer raises `misfiled`. A duplicate is composed from its twin's stored record (the `ingest.metadata` the work list returned with it); with none, its proposal is the twin's own name and folder.

**The namer.** The matter's party names and court file numbers are the ones fetched at the start of Step 8. Split the namer's rows into batches of about 15 and dispatch every batch **in one turn**, in parallel: Agent tool, `subagent_type: "file-manager:housekeeping-namer"`, `model: "haiku"`, `effort: "medium"`. If that agent type is not in this session's roster, stop and say so; no other agent composes names. Each dispatch carries one JSON object:

- `run_date`; `matter`: `root_name`, `parties`, `action_numbers`;
- `folders`: each on-disk filing folder (never one the profile skips, never 0 or 1, never `TRASH`), `{name, folder_type, subfolders}` with `folder_type` the folder type number the profile gives it and `subfolders` the relative paths of the folders inside it;
- `rows`: `{row_id, current_name, location (root | subfolder), containing_folder, store (main | law; a not-yet-ingested row takes the store its Step 8 routing points to), evidence_source (page_1 for a block from a page-1 read, the reader's or this session's for a draft; twin_record for a duplicate's twin), naming_evidence, attachments_present, notes}`. `attachments_present` lists the attachments confirmed present in the file (an affidavit's exhibits found by ingest), and is left out when there is no inventory to check against.

It returns one entry per row, in order: `proposed_name`, `name_confidence` (`ready` or `best_guess`), `doubtful_components`, `components` (each with value, status and facets), `destination` (`status` chosen, ambiguous or none; `folder`, `folder_type`, `exists`, `subpath`, `new_folder`, `candidates`), 2 to 4 `alternatives`, `flags` (`rule_gap` with its three escape-log pieces and reference file, `missing_attachment`, `contradiction`, `other_matter`, `unreadable`, `misfiled` with its proposed folder), and a one-sentence `reason`. A batch whose return is not one well-formed entry per row is re-dispatched once. If it fails again, its rows are `stuck` with the reason "the name could not be composed this run".

**Privileged rows, composed here.** Never send one to the namer. Fetch the same references it uses (`/file-naming`'s `general-conventions.md`, `code-registry.md`, `conformance-check.md` proposal mode; the profile and the candidate folders' notes) and follow the same procedure. For a root file: pick the code first from the registry and general conventions, map it through the registry's "Typical folders" column onto this matter's folders, read only those folders' notes, apply their "Misfile test" sections in reverse to narrow to one destination, then let that folder's notes govern the name. For a subfolder file: its containing folder's notes apply, and its misfile test, run forward, may raise `misfiled` with a proposed move. Produce the same report shape: components with statuses, flags, 2 to 4 alternatives, a reason.

**Rules the namer and this session share.** No code: No naming rule fits. A code but no candidate folder: no destination (Folder unclear). Two court-file folders: the `action_number` decides; none readable makes the destination ambiguous. A document with no date takes `0000-00-00` (or `0000-MM-DD`) and needs no signal when the whole document was read; only a date not established within the read is a signal. A numeric date that reads as two different dates (day and month both 12 or under and unequal, as in `03/04/26`) is not established unless another part of the document fixes the order; a stored-record date never does, since an earlier reader chose it from the same numeric date. The candidates for a root file are only the folder types the code's "Typical folders" column lists, a transmittal filed by its own code and never by what it carries; a typical folder missing on disk is a candidate like one that exists, never dropped for not existing, and is proposed by its folder type (Step 12 names it from the template). The namer's best guess on a care row, with its doubtful token marked, is this session's evidence only: a guessed name is never proposed. Codes are never minted: a document type with no code is a `rule_gap`. The delivery code of a `.pdf` letter is the registry code that describes the `transmission` facet's methods in printed order, under the code registry's order-of-sending rule, and is `inferred`, so the row stays eligible for `ready`. A `.eml` or `.msg` keeps its `E`-first code whatever the facet says, an incoming letter with no facet stays `LF`, and printed methods that no registry code describes are a `rule_gap`.

## Step 12 — Rows: checks, signals and precomputes

Build every row from Steps 7 to 11, using **Rows** (below) for its section, its signals and its one action. Then run these on every row:

**Destinations.**

- Destinations are the filing folders and any folder inside them; never a folder the profile skips, never folders 0 or 1 or anything inside them, and never `TRASH`. The one exception is `0. DRAFT` on a `draft` row. `0. DRAFT\Superseded` is matter-data's own destination for a superseded version of a court document, and no row proposes it.
- A folder counts as present when an on-disk name matches ignoring case and a trailing plural (`Disbursements` = `Disbursement`). Use the on-disk name.
- **Template.** The firm's standard folders are its matter template tree, every subfolder included; no skill keeps a copy, and this session lists it only through `housekeeping__preflight`. Read it only when some proposed destination is missing in the matter, once per run while the page is built: one `housekeeping__preflight` call with `include_template: true`, whose `template_folders` lists every template folder, every level, template-relative. A `template_missing` failure stops the run before the page is built: report the path it names. A proposed missing folder takes the name of the template folder of its folder type (by the practitioner's folder map), whatever spelling the namer gave it. When the template was read, `proposal.json`'s folder list also carries every missing template folder with `exists: false`, which may then be proposed and is created on apply, except folders 0 and 1, `TRASH`, a `Party #N` placeholder and a court-filings folder's bare stem (a template name ending in `#`). When it was not read, the list holds on-disk filing folders only.
- **Court file.** Compare a document's action number with the existing court-file folders ignoring spaces, hyphens, "No." and the registry name. With no match, propose a new folder named in the existing folders' form, this action's number in place of the other's; it is created on apply. No readable number: the destination is ambiguous.
- **Placeholders.** A template `Party #1` or `Party #2` folder is never created by that name: the actual party's name takes its place as a non-standard folder (`<discovery folder>\LOD Plaintiff\Jane Smith`). A party name used as a folder drops a trailing period (`Plaintiff Holdings Inc`), and no folder or file name ends in a dot or a space.
- **A non-standard folder** (not in the template) is proposed only inside a folder the folder map names, never directly under the root, and its action sets `create_folder: true`, so Approve creates it. A missing folder directly under the root that is not in the template is never proposed: the row loses its destination (`folder_unclear`), and is `stuck` unless another folder fits.

**Deterministic checks (every row, whatever the reader said).**

1. **Name gate** on the proposal, with the destination's flag tokens and the profile's second pass. A failing proposal is a signal.
2. **Collision.** Two rows proposing the same name for the same folder, or a file of the proposed name already in the destination, is a signal on each row concerned.
3. **Cross-check** every ingested row against its stored record: the work list's `ingest.metadata` for a row ingested before this run, Step 9's second `ingest-status` for one ingested now. The proposed name's date, code family and parties must agree with the stored date, category and parties. A disagreement is a Contradicts itself signal quoting both. The stored record is no longer evidence for the name (Step 10), so this is where the two still meet. It catches a reading that contradicts the ingest; it does not check truth.
4. **A reader report** missing or off contract twice is the Step 10 defect.

**Precomputes (`name_checks`).** For each row with a proposed name, check it against its one destination: that folder's name check (the gate with that folder's flag tokens, and the second pass for Law's citation and AI-memo forms and Discovery's listed-document form), and whether a file of that name is already there. Record the pair when it passes only through a folder's second pass. A name that raises one of the destination folder's flag tokens fails that folder's check even when it matches a second-pass format, and is never recorded `ok`. A name that fails, or clashes, is never proposed: pick another name or folder, or make the row `stuck` ("possible duplicate of <path>" for a clash). When the current name already passes the check for the destination, the row keeps it: `move` when the file needs another folder, `ingested_only` when it needs nothing.

**Rule gaps.** Every `rule_gap` becomes one `rule_gaps` entry: `run_date`, `matter_root` (each entry carries its own, so gaps can be read across matters), `file_name`, `trigger`, `current_rule`, `missing` (the three escape-log pieces), `reference_file`, `best_guess`. A rule-gap row is `stuck`, its reason naming the gap ("no naming rule for a bill of costs"); nobody acts on the gap in the run.

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
| `uncertain_name` Part of the name is uncertain | 2, a component not established | namer `best_guess` with doubtful components; a defective reader report |
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

Choose one action per row:

- **Could not read, failed ingest:** `unreadable`, unless the failure is deterministic and will not change, when file it without reading (`file_no_ingest`) or make it `stuck`.
- **Could not read, a kind ingest cannot read:** `file`/`move` with `file_no_ingest` (a name from what an image shows, else the current name), `draft` for a root file of a non-whitelisted kind, or `stuck`. A subfolder file filed without reading stays in its folder (`rename`, or `move` to its own folder).
- **Draft (root):** `draft`, unless the evidence shows the document final, when `file` with `final: true`.
- **Question:** pick the option the evidence best supports as `answer` on a `file` or `move` row; if none is supported, `stuck`.
- **Duplicate:** `duplicate`. Keep both (`file`/`rename`/`move` with `file_no_ingest`) only when the twin is ingested and the name does not clash with it.
- **Another matter:** `misfiled` with the matter's code or name.
- **Folder unclear:** pick the folder the evidence supports (a court file by action number); none: `stuck`.
- **Partial, a suspected authority duplicate reported for merge, any path holding a `privileged` or `disclosed` folder, no naming rule, contradictions or a component not established:** `stuck`, with the reason ("reading not finished; the next run carries on", "possible second copy of an authority; resolve with /matter-data first", "in a privileged folder, which housekeeping never moves", "no naming rule for a bill of costs", "heading and jurat name different deponents").
- **Everything else carrying signals (follow-up pending, authority second copy, attachment copy, misfiled within the matter, name taken, name check):** propose the move or rename when a clean name and folder exist, else `stuck`.

An order-effects, linkage or date-anchor row is filed normally: it is shown in the run that ingests the file, and once filed it is not re-admitted while the marker stays for its follow-up step. An authority second copy and a copy of an email attachment already read are both filed as ingested by reference.
