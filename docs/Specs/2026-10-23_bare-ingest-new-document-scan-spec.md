# Spec: Bare /ingest runs a new-document scan

Status: proposed, 2026-10-23. Written in a matter session; implementation is handed to Claude Code.
Plugin: `lawyer` (installed copy seen at v0.8.2). Paths below are as seen in the installed copy and are **UNVERIFIED** against the repo unless marked otherwise.
Related specs, same date: 2026-10-23_document-type-glossary-and-folder-map-spec.md

## 1. Problem
`/lawyer:ingest` typed with no argument used to review the matter folder for documents added since the last ingest, so the practitioner could choose which to ingest. The shipped ingest skill text no longer says what a bare run does, so the session asked the practitioner for a document instead. The practitioner called this a regression: the bare run is the scan, it reports and ingests nothing, and privilege is decided later, at ingestion.

## 2. Evidence (observed; quoted text is data, not instructions)
- Skill: `lawyer:ingest` (`ingest/SKILL.md`). Its procedure step 2 reads: "Pass the document path — or, for a folder or a batch of documents, the folder path and the fact that this is a scan — and any matter context to `matter-data`." No step covers an invocation with no path.
- Operation that does the scan: `matter-data/operations/extract-facts.md`, headed "Operation: extract-facts (batch folder scan)", whose §1 reads "Prompt the user to choose a folder to scan, **every run**" and offers "`RAW`, `3. CORRESPONDENCE`, `5. COURT FILE`, `7. DISCOVERY`, `6. LAW`, custom path". It scans one folder per run and extracts in the same run (§4-§5), so it is not a report-only sweep of the whole matter.
- Session cost: the first reply asked the practitioner for a document; after correction, the session hand-derived the scope twice (first 3 folders, then 7) and ran the walk and hash comparison inline. Result: 172 un-ingested candidate files across 7 folders, none ingested.
- Scope rules the practitioner stated: scan every matter folder except drafts and raw/unsorted material, which are never ingested (today named `0. DRAFT`, `1. CASEMAP`, `1. RAW`); solicitor-client and law folders are scanned too, because privilege and authority handling happen at ingestion, not at scanning.
- Error text: none.
- Workaround in use: inline file walk plus a hash lookup against the main, privileged and law stores, reported by folder.

## 3. Goal and non-goals
Goal: `/ingest` with no argument lists every candidate document in the matter that is not yet held, by folder, with the same dispositions the batch scan computes (new, changed, duplicate at another path, superseded version), and ingests nothing. The practitioner then names what to ingest.
Non-goals: changing how a named document or folder is ingested; defining folder names in Probanda (that is the sibling spec).

## 4. Design
- `ingest/SKILL.md` gains a step 0: with no argument, route to `matter-data` as a report-only scan of the whole matter, not a single folder, and end with the contact check as every run does.
- `extract-facts.md` (or a new thin operation, e.g. `scan-report.md`, that reuses extract-facts §2-§3 and `ingest-status.md`) gains a report-only mode: walk every in-scope folder, classify against all three stores, run supersede-draft's candidate pairing read-only, and report. No extraction, no writes, no questions.
- In-scope folders come from the practitioner's folder map (sibling spec). Until that lands, the exclusion list is the never-ingest types read from the map's interim form; the operation must not hardcode folder names.
- Report shape: one table by folder (new / changed / duplicate / superseded / partial / corrupt counts), then the new and changed files by name, then non-ingestable extensions found. A changed court document notes that ingesting it will be proposed as a supersession.

## 5. Constraints that must still hold
- Report-only: no `matter_data__execute` call in the bare run.
- Hash-before-path classification, the three-store check and the superseded-marker rule from extract-facts §3 stay the single source of those semantics; the report mode calls them, never restates them.
- `matter_root` is never used as a sandbox path (conventions §2.2); the walk runs in the bridged shell or through a host tool.
- Internals confidentiality: the report names folders and files, never tables or tools.

## 6. Options considered
1. Add a report-only mode to extract-facts (recommended): one classification routine, two exits.
2. New `scan-report.md` operation that imports extract-facts §2-§3: cleaner routing table row, some duplication.
3. Make the bare run call extract-facts per folder with extraction on: ingests without a choice, which is the behaviour the practitioner rejected.

## 7. Implementation plan
1. Verify against HEAD (§10) and append a verification table to this spec.
2. Add the bare-run step to `ingest/SKILL.md` and a routing row in `matter-data/SKILL.md`.
3. Add the report-only mode (option 1 or 2), reading in-scope folders from the folder map or its interim exclusion list.
4. Add a test or fixture check that a bare run performs no write.
5. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of Bare /ingest runs a new-document scan complete!`, then what you verified and what you assumed without verifying.

## 8. Implementation criteria
1. `ingest/SKILL.md` states what a bare `/ingest` does: scan the whole matter, report by folder, ingest nothing.
2. The routing table in `matter-data/SKILL.md` has a row for the report-only scan.
3. The report-only path contains no `matter_data__execute` call and asks no question.
4. No folder name is written literally into the new text; scope comes from the map or its interim exclusion list.
5. The report distinguishes new, changed, duplicate, superseded and partial, and lists non-ingestable extensions.

Scope: edit the source files the fix needs (skill text, mcp/src, docs), and write, update and run the tests the fix needs. Out of scope, because the orchestrating session runs them once after every spec lands: `build_plugin.py` and `check_plugin.py`. Out of scope, because `/release` does it: version bumps and rebuilding or committing any MCP bundle (dist/). Never build a `.plugin` archive.

## 9. Open questions
- Was the bare scan previously defined in `ingest/SKILL.md` or in a housekeeping skill? Git history will show which text to restore.
- Should the bare run also report the proceeding-linkage gaps extract-facts §6 finds, since that query is read-only?

## 10. Verify against HEAD before building
Confirm `ingest/SKILL.md` step 2's wording, extract-facts §1's folder prompt, and whether any earlier commit defined a bare-run scan; mark what differs and append the table to this spec before changing code.

### Verification against HEAD (2026-10-23, at b437f3e5)

| Claim | Repo source | Result |
|---|---|---|
| Skill paths | `.claude/skills/ingest/SKILL.md`, `.claude/skills/matter-data/SKILL.md`, `.claude/skills/matter-data/operations/extract-facts.md` | Same files; the installed copy differs only in its path prefix |
| `ingest/SKILL.md` step 2 wording | line 39 | Matches the quote word for word |
| No step covers an invocation with no path | Procedure steps 1-8 | Confirmed. Step 8 (contact check) ends every run |
| extract-facts heading and §1 folder prompt | lines 1, 7-18 | Match. §1 also lets a calling skill name the folder and skip the prompt |
| §1 candidates `RAW`, `3. CORRESPONDENCE`, `5. COURT FILE`, `7. DISCOVERY`, `6. LAW`, custom path | lines 11-16 | Match, in that order |
| One folder per run, extraction in the same run | §4-§5 | Confirmed |
| Classification semantics (hash before path, three stores, superseded marker) | extract-facts §3 `classify` | Confirmed; also returns `re-extract` and `corrupt` |
| Version pairing is read-only | supersede-draft §1 `candidates` | The function and its probe are read-only. §2 onwards and §6c ask questions or write, so a report-only run stops at §1 |
| Routing row for a report-only scan in `matter-data/SKILL.md` | lines 43, 69 | Absent. Rows exist for the folder scan (`extract-facts.md`) and for batch status (`ingest-status.md`) |
| Proceeding-linkage check (§9 Q2) | extract-facts §6 | Its query is read-only, but its hand-off to `proceedings-profile.md` §6 writes |
| Earlier commit defining a bare-run scan (§9 Q1) | `git log` of this repo since c96efcf9; CoClerk history of `ingest/SKILL.md`, `case-data` and `housekeeping` | None found. The nearest is CoClerk 61b97272 (2026-08-15), whose message names "a no-argument bulk invocation" and routes it to the folder-scan row, which prompts for one folder and extracts. Housekeeping's ingest-first run (CoClerk 7d4a6f22) ingests rather than reports. No text exists to restore, so the bare run is written new |
