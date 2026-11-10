# Litigation matter profile

**Detection:** the root folder is a matter folder: it holds the matter
pointer (`probanda.json`, or the legacy `coclerk.json`), or at least one of its
subfolders matches a folder glob in the practitioner's folder map
(`practice_data__folder_map`). No folder name is the signal.

**Kind:** rename-in-place

**Extension whitelist:** `.pdf .docx .doc .eml .msg .xls`, case-insensitive,
one glob per extension, nothing else.

## Scope — folder types from the folder map

Read the practitioner's folder map (`practice_data__folder_map`). It says
which of the matter's folders hold each document type
(`shared/document-types.md`). With `status` `no_map`, run `/probanda-setup`
step 6 first. The map file and how it works are never named to them.

With a map, give each folder of the matter that a map glob matches the first
**folder type** below whose document types it holds. The folder types group the
glossary's types for review: each has its own notes file and its own number,
which `/file-naming`'s code registry ("Typical folders") and the namer use.

| Folder type | Document types | Folder notes |
|---|---|---|
| 2 — Solicitor Client | `client_communications`, `retainer_and_billing` | `notes/solicitor-client-notes.md` |
| 3 — Correspondence | `correspondence_opposing_counsel`, `correspondence_unrepresented_party`, `correspondence_witness`, `correspondence_expert`, `correspondence_court`, `correspondence_non_party` | `notes/correspondence-notes.md` |
| 4 — Lawyer Brief | `work_product`, `searches` | `notes/lawyer-brief-notes.md` |
| 5 — Court File | `court_filings` | `notes/court-document-notes.md` |
| 6 — Law | `authorities` | `notes/law-notes.md` |
| 7 — Discovery | `documents_exchanged` | `notes/discovery-notes.md` |
| 8 — Trial Brief | `trial_materials` | `notes/trial-brief-notes.md` |
| 9 — Disbursements | `disbursement_records` | `notes/disbursement-notes.md` |

**Record each matched folder's exact name and absolute path as listed on disk,
and reuse that string verbatim everywhere downstream** — namer dispatches,
`proposal.json`'s folder list, and every path handed to the apply tools. The
map match is for *classification only*: never re-type or abbreviate a folder
name from memory afterwards. A glob such as `Court*` is not the folder it
matched, and a `cd` into the glob fails.

**Always skip** every folder whose document types are all `never_ingest`
(drafts, raw or unsorted intake): these hold working material, not finished
records, so renaming there adds noise. The drafts folder's `Superseded`
subfolder is matter-data's deliberate destination for a superseded version of a
court document, and is skipped with it. Also skip any folder the map does not
name unless the user explicitly asks for it, and name it so the practitioner
can add it to the map.

**Disambiguation tips:** when a folder holds types of two folder types, it
takes the first in the table, and the namer is told every type it holds. If
the map matches two court-filings folders (two actions), treat each as in
scope; a document's action number decides which one it belongs in.

**Argument rule:** if the caller received a single subfolder path as an
argument, scope the run to that folder's type only — skip the full sweep. If
the argument is the matter root, run the normal full sweep. If the argument is
a file list, restrict the run to the named files only. If it doesn't map to any type above,
ask which folder to review instead of guessing.

If a folder type has no matching subfolder in this matter, there is nothing
of that type to sweep.

## Name-gate second pass (alternate whole-name formats)

Some folders define alternate whole-name formats the mechanical gate
(`/file-naming`'s **gate** intent) doesn't know: Law's citation form and
AI-memo source-name form (`notes/law-notes.md`), Discovery's
`[Party][Part].[No]` listed-document form (`notes/discovery-notes.md`). Check
each gate failure in those folders against its notes file's stated format — a
match **conforms**, exactly as the notes describe it. A Law file whose gate
result carries a flagged token goes on the work list even if it otherwise
matches citation form — the flag means a suffix-vs-substantive call that only
the caption can resolve (`notes/law-notes.md`). The name gate itself makes no
suffix judgment beyond reporting that flag.

For `/housekeeping`'s work list the server applies the mechanical forms
itself: Law's citation form and its `Alexi`, `Westlaw` and `Claude` AI-memo
forms, Discovery's `[Party][Part].[No] - ` prefix before a name that passes
the gate, and Discovery's legacy bare item numbers (left alone, so they
conform). Every other failure in those folders comes back as
`second_pass_required`, and the session judges it against the notes as above.

**Flag tokens:** for the Law folder, pass the corporate-designator drop list
(`notes/law-notes.md`) to `/file-naming`'s gate as `--flag-tokens` so a
flagged token surfaces regardless of verdict.

## Record backend

The review record lives in the matter's case database, reached **only** by
invoking the `/matter-data` skill — never queried directly.

Invoke `/matter-data` and ask whether this matter has a case database. It owns
locating and validating the matter pointer; do not go looking for pointer
files yourself, and do not assume where they live.

In the same delegation, request the pointer-health intent and surface its
result as exactly one line (`Pointer health: healthy`, `healed — ...`, or
`unhealthy — ...`) before continuing. Never inspect a pointer or database
directly.

**It has one** → the record is available; the lookup itself happens once
there is a work list to look up.

**It has none** → this matter has no case database, so there is nowhere to
keep the record. Tell the user plainly what that costs — every file will be
reviewed fresh on this run and on every future run, because nothing will be
remembered — and offer to set one up:

- Use `AskUserQuestion` with two options: **set up the case database now**
  (invoke `/matter-data`, which owns initialization) or **run without the
  record this time**.
- If they choose to set it up, invoke `/matter-data` and let it initialize.
  Once initialization succeeds, tell the practitioner, word for word:

  > "The case database is now set up. To review and rename files, please start a new conversation and run housekeeping there — setting up the database and reviewing files are kept in separate conversations so each one's cost can be tracked on its own."

  Then end the run. Nothing after this point happens — no scope
  resolution, no name gate, no ingest, no namer dispatch, no rename, no record
  write. Setting up the database and reviewing files never share a
  session, so each one's cost can be measured on its own.
- If they choose to run without it, continue with the record unavailable.
  **Skip the record gate and skip the record-writing step entirely** — do
  not invent a local cache file as a substitute. A run with no memory is a
  correct run that costs more; a silently improvised memory is neither.

Ask once. Do not re-offer later in the same run.

**If the record is unavailable for any other reason** — `/matter-data` reports
a stale pointer, a schema-version guard failure, or its tools are absent from
this session — say so explicitly, name the error it gave, and ask the same
two-option question. Never swallow the failure and run as though the matter
simply had no record: a matter that *has* a database and can't reach it is a
problem the user needs to see. If they choose **set up the case database
now** here, the same stop applies: once initialization succeeds, deliver
the same verbatim message above and end the run.

**Lookup intent:** `/matter-data`'s housekeeping-log **lookup**, given a batch
of `{file_name, file_hash}` pairs — returns, per candidate, whether it's
already reviewed and (if so) its outcome and date.

**Record intent:** `/matter-data`'s housekeeping-log **record**, given
`{file_name, file_hash, folder_type, outcome}` rows for applied files only:
`outcome` `renamed` (a move was applied: rename and file, rename in place, a
same-matter move, or a root file filed under its current name),
`manual_review` (a subfolder file's "keep the current name"), or
`not_ingested` (filed without ingesting); `file_name` the name the file now
carries, and `folder_type` the folder type of the folder it now sits in. A
"Move to 0. DRAFT unchanged" writes no row, and neither does an unapproved
file. An ingest failure is recorded by `/matter-data`'s ingest itself, as
`ingest_failed`. Never send a `declined` outcome — nothing writes it.

## Working files

A `/housekeeping` run's files live in its run directory,
`<matter-data folder>\housekeeping\<run-id>\`, where the matter-data folder is the
one the matter's `probanda.json` names in `case_data_dir` — never a guessed
literal. It must already exist; `housekeeping` beneath it is created on demand.
The litigation data server creates the directory
(`housekeeping__new_run`) and writes every file in it (`proposal.json`,
`questions.json`, `rule_gaps.json`, `approval.json`, `applied.jsonl`); the
session only reads it. Run directories are never deleted. No `hashes.json` or
`rename-plan.json` is written.
