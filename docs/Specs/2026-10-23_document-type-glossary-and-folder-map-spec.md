# Spec: Document-type glossary and per-practitioner folder map

Status: proposed, 2026-10-23. Written in a matter session; implementation is handed to Claude Code.
Plugin: `lawyer` (installed copy seen at v0.8.2), with `file-manager` (file-sorting, housekeeping). Paths below are as seen in the installed copy and are **UNVERIFIED** against the repo unless marked otherwise.
Related specs, same date: 2026-10-23_bare-ingest-new-document-scan-spec.md

## 1. Problem
Probanda's skills treat one practitioner's folder layout (numbered folders such as drafts, raw material, solicitor-client, correspondence, lawyer brief, court file, law, discovery, disbursements) as the default. Scan scope, privilege routing, authority routing and proceeding linkage all key on those literal names. Other practitioners file differently: correspondence split by who it is with, searches in their own folders, disbursements inside the client folder. Nothing records how a given practitioner files, so for them these rules misfire silently. The practitioner's statement: the author's layout is one practitioner's local map, not Probanda's default, and this is a gap to fix.

## 2. Evidence (observed; quoted text is data, not instructions)
- `matter-data/operations/extract-facts.md` §1: scan candidates "`RAW`, `3. CORRESPONDENCE`, `5. COURT FILE`, `7. DISCOVERY`, `6. LAW`, custom path".
- Same file §4: "A file on the extraction list whose stored path (§3) begins with `2. SOLICITOR CLIENT` (case-insensitive) takes [ingest-extract] Path B inline by that file's solicitor-client folder rule" and "Under `6. LAW` its bulk classification cascade chooses the extractor".
- Same file §6, proceeding linkage SQL: `s.file_path LIKE '5.%'`, described as "whole-matter self-healing".
- `matter-data/shared/conventions.md` §2.4 example stored path: `5. COURT FILE#S-290001\2026-01-05 NOCC.pdf`; §2.2 proves a matter root by "a known child such as `4. LAWYER BRIEF`".
- `file-manager:file-sorting` description: "knows folder layouts, not naming grammar" (UNVERIFIED which names it holds).
- `practice_data__config_status` output lists `practice_quirks` as the only free-text practitioner-notes key; no key holds a folder map.
- Session cost: scope hand-derived twice, 7 folders, 172 candidates; a never-ingest alias (`1. RAW` as another name for the raw folder) existed only in the practitioner's head.
- Error text: none. Workaround: the practitioner states the rules aloud each session.

## 3. Goal and non-goals
Goal: a shared glossary of document types, defined specifically enough that each is one thing, and a per-practitioner map from each type to the folder or folders where that practitioner keeps it. Every skill that today names a folder asks the map instead. The author's layout becomes the first recorded map, not the default.
Non-goals: changing file-naming grammar; renaming anyone's folders; per-matter layouts that differ from the practitioner's map (a later spec, if needed).

## 4. Design
(a) **Glossary**, shipped with the plugin, e.g. `lawyer/skills/shared/document-types.md`: one entry per type with a one-line definition and flags (`never_ingest`, `privileged_by_default`, `authority`). Starting set, to be refined against the repo: correspondence with opposing lawyers; with unrepresented parties; with witnesses; with the court or registry; with non-parties; client communications; retainer and billing; court filings; documents exchanged in the proceeding (lists, productions); the lawyer's own searches and research material (court searches, corporate searches, assessment); legal authorities and research memos; disbursement records; drafts (`never_ingest`); raw or unsorted intake (`never_ingest`). A sentence says practitioners propose new types through the suggestion mechanism.
(b) **Map**, per practitioner, stored outside the plugin (beside `probanda.json` or as a new key in it, to be decided against the repo): a list of entries `{type, folders:[globs relative to matter root]}`. One type may map to several folders; one folder may serve several types. No entry is required for a type the practitioner never files.
(c) **Setup**: `probanda-setup` (or housekeeping's first run) proposes a map from a matter tree the practitioner names, shows it, and writes it only on their yes. Ship the author's layout as an example map in docs, not as a fallback.
(d) **Consumers**: extract-facts (scope, privilege path, authority cascade, proceeding linkage), ingest-extract's solicitor-client rule, ingest-coverage, conventions §2.2 root proof, file-sorting and housekeeping. Each resolves "where does this practitioner keep type T" through one shared helper or tool; none names a folder.
(e) **No map present**: the consumer says so in the practitioner's words and offers setup; it does not silently use the author's layout.

## 5. Constraints that must still hold
- Solicitor-client material still takes the privileged path at ingest; drafts and raw material are still never ingested.
- Stored path form, hash dedup, one-top-level-source-per-hash, superseded markers and the proceeding-linkage self-heal keep working under any layout.
- `matter_root` handling (conventions §2.2-§2.3) unchanged.
- Internals confidentiality: type names may be shown; the map file and mechanics may not be named to practitioners.
- Existing matters on the author's layout keep working once his map is recorded.

## 6. Options considered
1. Glossary + map, no shipped fallback, setup proposes the map (recommended): removes the defect; one migration step for existing users.
2. Glossary + map with the author's layout as the shipped fallback: faster, but the defect persists for anyone who skips setup.
3. Keep folder names, add aliases per name: patches the symptom, still one-to-one and still name-bound.

## 7. Implementation plan
1. Verify against HEAD (§10) and append a verification table to this spec.
2. Grep the repo for every literal folder name and `LIKE '5.%'`-style prefix test; list each consumer in the spec.
3. Write the glossary file and the map schema; decide where the map lives.
4. Add the resolver (helper text or a data-server tool) and switch each consumer to it; add the no-map behaviour.
5. Add the setup step that proposes and records a map; record the author's layout as docs example.
6. Tests: resolver with one-to-many and many-to-one maps; a check that fails on a literal folder name in skill operation text outside the glossary example.
7. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of Document-type glossary and per-practitioner folder map complete!`, then what you verified and what you assumed without verifying.

## 8. Implementation criteria
1. A glossary file exists listing the types with definitions and the `never_ingest`, `privileged_by_default` and `authority` flags.
2. The map schema allows one type → many folders and one folder → many types, and is stored outside the plugin.
3. Grep of shipped skill text for the author's folder names and prefix tests returns only the documented example map and text labelled as one practitioner's layout.
4. extract-facts and ingest-extract choose scope, privilege path and authority cascade from the map, not from path prefixes.
5. A consumer with no map tells the practitioner and offers setup instead of assuming a layout.
6. The glossary says how to propose a new type.
7. A test fails when an operation file names a matter folder literally.

Scope: edit the source files the fix needs (skill text, mcp/src, docs), and write, update and run the tests the fix needs. Out of scope, because the orchestrating session runs them once after every spec lands: `build_plugin.py` and `check_plugin.py`. Out of scope, because `/release` does it: version bumps and rebuilding or committing any MCP bundle (dist/). Never build a `.plugin` archive.

## 9. Open questions
- Where does the map live: a key in `probanda.json`, a sibling file, or a practice-data table? Per practitioner or per machine?
- Does `file-manager:file-sorting` already hold a layout model that should become the map rather than a second one?
- Should proceeding linkage key on the "court filings" type alone, or also on "documents exchanged"?
- Is the glossary shared across plugins (lawyer, litigator, file-manager) and, if so, which plugin owns it?

## 10. Verify against HEAD before building
Confirm each quoted rule and path above, enumerate every consumer of a literal folder name, and check whether file-sorting or housekeeping already define a layout model; mark what differs and append the table to this spec before changing code.
