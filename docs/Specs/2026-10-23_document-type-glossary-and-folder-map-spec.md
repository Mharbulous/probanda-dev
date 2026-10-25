# Spec: Document-type glossary and per-practitioner folder map

Status: implemented, 2026-10-23 (§12). Written in a matter session; implementation is handed to Claude Code.
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
(c) **Setup**: `probanda-setup` (or housekeeping's first run) proposes a map from a matter tree the practitioner names, shows it, and writes it. Ship the author's layout as an example map in docs, not as a fallback.
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
3. Grep of the read-side consumers (§11.2's read-side table) for the author's folder names and prefix tests returns nothing. Narrowed on 2026-10-23 (§12): `0. DRAFT*` and `6. LAW` stay fixed folders that Probanda writes into, so the write-side group keeps them, and the documented example map (§13) is the only place the rest of the author's layout appears.
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

## 11. Verification against HEAD (b437f3e5, 2026-10-23)

Paths are relative to the repo root. Skills live under `.claude/skills/`, and the data server under `source/lawyer/mcp/src/`.

### 11.1 Quoted evidence (§2)

| Claim | Result | Where |
|---|---|---|
| extract-facts §1 offers `RAW`, `3. CORRESPONDENCE`, `5. COURT FILE`, `7. DISCOVERY`, `6. LAW`, custom path | Confirmed. The raw folder is listed as bare `RAW` | `matter-data/operations/extract-facts.md` lines 11-16 |
| extract-facts §4: stored path beginning `2. SOLICITOR CLIENT` takes Path B inline | Confirmed | same file, line 154 |
| extract-facts §4: under `6. LAW` the bulk cascade chooses the extractor | Confirmed | same file, line 158 |
| extract-facts §6: `s.file_path LIKE '5.%'`, "whole-matter self-healing" | Confirmed | same file, lines 184 and 189 |
| conventions §2.4 example `5. COURT FILE#S-290001\2026-01-05 NOCC.pdf` | Confirmed | `matter-data/shared/conventions.md` line 90 |
| conventions §2.2 root proof by "a known child such as `4. LAWYER BRIEF`" | Confirmed | same file, line 62 |
| file-sorting "knows folder layouts, not naming grammar" | Confirmed. It holds a layout model (§11.3) | `file-sorting/SKILL.md` line 4 |
| `practice_quirks` is the only free-text practitioner key, and no key holds a folder map | Confirmed. The documented keys of the machine's `probanda.json` are `version`, `case_data_root`, `firm`, `review`, `person`, `signature`, `practice_quirks`, `briefing`, `accounting`, `repo_root`, `page_api_port` | `source/lawyer/mcp/src/tools/practice/config.ts` `DOCUMENTED_KEYS` |
| `1. RAW` as a never-ingest alias existed only in the practitioner's head | Differs. file-sorting's litigation profile already names `1. RAW` and `1. CASEMAP` as folder 1, always skipped. extract-facts lists only `RAW`, and no ingest file treats folder 1 as never-ingest | `file-sorting/profiles/litigation-matter/profile.md` "Always skip" |
| ingest-extract's solicitor-client rule keys on the folder name | Confirmed: first stored-path segment begins `2. SOLICITOR CLIENT`, "the same match as the ingest-coverage glob" | `matter-data/operations/ingest-extract.md` line 69 |

### 11.2 Consumers of a literal folder name or prefix test (§7 step 2)

Test files and generated `build/` copies are left out. Each row is a consumer, grouped by what it does with the name.

**Read side: scope, privilege, authority, proceeding linkage (spec §4(d))**

| Consumer | Names it uses | What for |
|---|---|---|
| `matter-data/operations/extract-facts.md` §1, §4, §6 | `RAW`, `2. SOLICITOR CLIENT`, `3. CORRESPONDENCE`, `5. COURT FILE`, `6. LAW`, `7. DISCOVERY`, `LIKE '5.%'`, `5.*` | scan candidates, privileged path, authority cascade, proceeding self-heal |
| `matter-data/operations/ingest-extract.md` lines 5, 69, 99-100, 293, 394 | `2. SOLICITOR CLIENT`, `0. DRAFT`, `5. COURT FILE`, `6. LAW\`, `1. RAW` | solicitor-client rule, affidavit draft/filed folder evidence, authority cascade, name check |
| `matter-data/shared/extraction-protocol.md` line 149 | `6. LAW\` | bulk classification cascade |
| `matter-data/operations/ingest-unattended.md` lines 70, 86 | `2. SOLICITOR CLIENT`, `6. LAW` | privileged path, cascade tier 4 |
| `matter-data/operations/ingest-coverage.md`; `matter-data/references/scripts/ingest_coverage.py` `FOLDER_GLOBS`; `source/lawyer/mcp/src/case/ingest-coverage.ts` `FOLDER_GLOBS`, `CORRESPONDENCE_GLOBS` | `2. SOLICITOR CLIENT*`, `3. CORRESPONDENCE*`, `5. COURT*`, `7. DISCOVERY*` | which folders count toward ingest coverage |
| `source/lawyer/mcp/src/knowledge/declared-layout.ts` `INGEST_INPUTS`; `shared/declared-layout.md` §5 `ingest_inputs` | the same four globs, as a closed vocabulary the runtime validates | which folders a Writing's jobs read before `/draft` claims a job |
| `matter-data/shared/conventions.md` §2.2, §2.4 | `4. LAWYER BRIEF`, `5. COURT FILE#…` | root proof; stored-path example |
| `matter-data/operations/proceedings-profile.md` line 72 | `5.*`, `5. COURT FILE #…` | grouping a scan's court rows by folder |
| `matter-data/operations/supersede-draft.md` line 59 | `5. COURT…` | two newcomers in the same proceeding |
| `matter-data/SKILL.md` line 43 | `6. LAW\` | routing row |
| `file-sorting/SKILL.md`; `file-sorting/profiles/litigation-matter/profile.md` and its `notes/` | `0. DRAFT`, `1. RAW`, `1. CASEMAP`, `2.`-`9.` by keyword | folder types, skip list, notes per folder type (§11.3) |
| `housekeeping/SKILL.md` lines 77-107, 201-226, 254, 264, 324; `source/file-manager/agents/housekeeping-namer.md` lines 88-92 | `0. DRAFT`, folders 0 and 1, `4. LAWYER BRIEF`, `5. COURT FILE#`, `6. LAW`, `7. DISCOVERY`, `9. DISBURSEMENTS` | sweep scope, destinations, proposed folder names |
| `source/lawyer/mcp/src/housekeeping/zones.ts` (`/^0\. DRAFT/i`, `/^[01]\./`), `proposal.ts`, `resolve.ts` line 372, `preflight.ts` | `0. DRAFT*`, folders 0 and 1, `5. COURT FILE#` | never-a-destination rule, draft destination, folder-stem matching |
| `probanda-setup/references/folder-layout.md` | every default, as a comparison table | setup step 6. It currently says "Nothing about the mapping is recorded" |

**Write side: folders Probanda writes into**

| Consumer | Name | What for |
|---|---|---|
| `source/lawyer/mcp/src/files/matter-root.ts` `findDraftDir`; `submission/forms.ts` `resolveDraftDir`; `submission/*` (writing-folder, publish-host, draft-harness, open-session, matter-pages, assemble-tools, render-manifest, pre-filing, board files); `correspondence/reply-draft.ts`; `file_ops/move.ts` | `0. DRAFT*` | drafts, Job Boards, published documents, `Superseded\`, research scratchpad |
| `source/lawyer/mcp/src/files/research-filing.ts` (`LAW_SEGMENT = "6. law"`), `legislation-search.ts`, `research/preflight.ts`; `source/researcher/agents/legislation-fetcher.md`, `research-agent.md`, `citation-checker.md`; `shared/legal-research.md`, `shared/research-paralegal/*`, `shared/legal-audit-*.md`, `legal-research/*` | `6. LAW\<issue>\` | filing research and downloaded authorities, and the refusal `not_law_folder` |
| drafting, publish, assemble, calculate, draft letter types, bill-client, executive-assistant and about 60 further prose files | `0. DRAFT`, `3. CORRESPONDENCE`, `5. COURT FILE`, `9. DISBURSEMENTS` and others | where a draft, a sent letter or a published document is saved or looked for |
| `0. CASE DATA` (conventions §2.1, `case/backend.ts`, `matter-root.ts`) and the legacy `9. AI` | Probanda's own folders | case data store. Not a practitioner's layout, so outside this spec |

A grep over `.claude/skills` and `source` for the numbered names found about 150 non-test files. The read-side group above is the set §4(d) names. Criterion 3 as written ("grep of shipped skill text ... returns only the documented example map") also covers the whole write-side group.

### 11.3 Existing layout models

- **file-sorting already holds a layout model.** `profiles/litigation-matter/profile.md` maps a matter's subfolders by keyword to eight folder types (2 Solicitor Client, 3 Correspondence, 4 Lawyer Brief, 5 Court File, 6 Law, 7 Discovery, 8 Trial Brief, 9 Disbursements), each with a notes file, and skips folders 0 and 1. It is one firm's layout, shipped in `file-manager`, keyword-matched, not per practitioner and not stored outside the plugin.
- **probanda-setup** compares a practitioner's matter folder against the defaults (step 6) and deliberately records nothing.
- **The data server** hard-codes `0. DRAFT*`, `6. LAW` and the four ingest globs, and validates `ingest_inputs` against them.
- **Where practitioner settings live today:** this machine's `probanda.json` (Roaming), written through `practice_data__upsert_firm_profile` (`practice_quirks`, `person`, `signature`). Firm-wide settings live in `<case_data_root>\_practice\firm\firm.json`.

### 11.4 Open questions the repo settles

- §9 Q2 (file-sorting layout model): yes, see §11.3. The glossary's types should take over its eight folder types, and the map should replace its keyword table, rather than a second model beside it.
- §9 Q3 (proceeding linkage): today's first arm covers only the court-file folder, and the second arm covers `category = 'court'` rows anywhere in the scanned folder. Keeping behaviour (§5) means the "court filings" type alone.
- §9 Q4 (glossary home): `.claude/skills/shared/` is copied whole into every plugin, and `lawyer` names nothing in another plugin. A glossary at `.claude/skills/shared/document-types.md` is readable by `lawyer`, `litigator` and `file-manager` without a layering ruling.

## 12. Decisions (Brahm, 2026-10-23)

- **Q1, where the map lives: one file per roster person, synced.** `<case_data_root>\_practice\firm\folder-maps\<roster key>.json`, the same pattern as `email-signatures\<key>.htm`. A firm-wide map in `firm.json` was rejected because every lawyer files differently. The resolver takes the person this machine's `probanda.json` names (`person`). No person set, or no file for that person, is the no-map case: the consumer runs setup step 6. It never falls back to another person's map or to the author's layout.
- **Q5, scope: read side only.** `0. DRAFT*` and `6. LAW` stay fixed folders that Probanda writes into. Moving them onto the map would touch most drafting, publishing and research-filing tools for no gain, because Probanda creates and fills those folders itself. Criterion 3 is narrowed to the read side accordingly. The housekeeping move guard that never takes a destination in a folder numbered 0 or 1 (`housekeeping/zones.ts`) is a write-side guard and is unchanged.
- **Q2-Q4** as settled in §11.4.

As built: the glossary is `.claude/skills/shared/document-types.md`, and the data server parses it as the one source of the type ids and flags. `practice_data__folder_map` reads the map and resolves stored paths to types and flags, a flag holding only when every type of the path's folder carries it. `practice_data__set_folder_map` writes it. `/probanda-setup` step 6 proposes it. A layout block's `ingest_inputs` names document types, and session entry resolves them through the map. file-sorting's eight folder types stay as groupings of document types, keyed to their notes files and the code registry's "Typical folders".

## 13. Example map: the author's layout

One practitioner's map, for illustration only. It ships nowhere and is never a fallback.

```json
{
  "entries": [
    { "type": "drafts", "folders": ["0. DRAFT*"] },
    { "type": "raw_intake", "folders": ["1. RAW*", "1. CASEMAP*"] },
    { "type": "client_communications", "folders": ["2. SOLICITOR CLIENT*"] },
    { "type": "retainer_and_billing", "folders": ["2. SOLICITOR CLIENT*"] },
    { "type": "correspondence_opposing_counsel", "folders": ["3. CORRESPONDENCE*"] },
    { "type": "correspondence_unrepresented_party", "folders": ["3. CORRESPONDENCE*"] },
    { "type": "correspondence_witness", "folders": ["3. CORRESPONDENCE*"] },
    { "type": "correspondence_expert", "folders": ["3. CORRESPONDENCE*"] },
    { "type": "correspondence_court", "folders": ["3. CORRESPONDENCE*"] },
    { "type": "correspondence_non_party", "folders": ["3. CORRESPONDENCE*"] },
    { "type": "work_product", "folders": ["4. LAWYER BRIEF*", "4 LAWYER BRIEF*"] },
    { "type": "searches", "folders": ["4. LAWYER BRIEF*", "4 LAWYER BRIEF*"] },
    { "type": "court_filings", "folders": ["5. COURT*"] },
    { "type": "authorities", "folders": ["6. LAW"] },
    { "type": "documents_exchanged", "folders": ["7. DISCOVERY*"] },
    { "type": "trial_materials", "folders": ["8. *BRIEF*", "8. TRIAL*"] },
    { "type": "disbursement_records", "folders": ["9. DISBURSEMENT*"] }
  ]
}
```
