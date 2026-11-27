# Spec: Unstructured Writings fetch official forms themselves instead of asking the practitioner to save them

Status: proposed, 2026-11-27. Written in a matter session; implementation is handed to Claude Code.
Plugin: `litigator` (installed copy seen at v0.30.2). Paths below are as seen in the installed copy and are **UNVERIFIED** against the repo unless marked otherwise.
Related specs, same date: 2026-11-27_bcca-general-caption-word-output-spec.md

## 1. Problem
draft/references/unstructured.md §2 tells the session to ask the practitioner to download and save the venue's published form. That hands clerical work back to the practitioner. Brahm wants official-source templates, forms, precedents, practice directives and guidelines fetched by the session, with a separate ask only for unofficial sources.

## 2. Evidence (observed; quoted text is data, not instructions)
- Rule text: "1. Ask the practitioner to save the published form, a PDF from the venue's own site where there is one, anywhere in the matter folder, and to say where." (source: draft/references/unstructured.md §2)
- The filed render refuses `unwritten_gate_failed` naming `form-source` until the copy is linked. In session this blocked the Word output.
- The session's sandbox shell got "403 host is not on the allow list" for bccourts.ca. The session fetched the .docx through Claude in Chrome (blob download into Downloads), then `file_ops__move_from_downloads` into "6. LAW\BCCA prescribed forms". That took ~6 tool calls.
- Separate from Probanda: the Claude host's own safety rules require explicit chat permission before any file download. Skill text cannot grant it. The practitioner's request can, when it names the download.

## 3. Goal and non-goals
Goal: the session obtains official forms itself and asks the practitioner at most once, up front, and never asks the practitioner to do the download. Non-goals: changing host safety rules, unofficial sources.

## 4. Design
Replace §2 step 1 with: obtain the form from the venue's official site (a short allowlist of official hosts per venue, e.g. bccourts.ca and bclaws.gov.bc.ca for BCCA) by the browser route and file_ops__move_from_downloads, into the matter's LAW forms folder. When the host requires a yes for the download, ask it in the session's first reply, naming the file and source, alongside the first draft, never as a stop later. Ask separately only for a non-official source.

## 5. Constraints that must still hold
- The form's fixed wording is still copied from the saved copy, never from memory.
- No download from a host off the official list without the practitioner's yes.
- File moves stay moves (file_ops), never copies.

## 6. Options considered, streamline and deburr first, additions last
1. Rewrite §2 step 1 in place to the session-fetch rule, with official hosts listed in each venue.md (recommended).
2. A shared doctrine file on official-source fetching, cited from unstructured.md and the localize skill: adds a file.
3. A data-server tool that downloads from an allowlist host-side: biggest change; still subject to the host's permission rule.

## 7. Implementation plan
1. Verify against HEAD (§10) and append a verification table to this spec.
2. Rewrite unstructured.md §2 step 1 per §4. Delete the "ask the practitioner to save" text.
3. Add the official hosts to each venue.md that has a stock unstructured type (or to the localize source records, if they already hold them).
4. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of official form fetch complete!`, then what streamlining and deburring you tried, what you verified and what you assumed without verifying.

## 8. Implementation criteria
1. unstructured.md no longer tells the session to ask the practitioner to save a form.
2. It says to fetch from an official host and to ask, at most once and up front, only where the host requires it or the source is unofficial.
3. Each venue with a stock unstructured type names its official hosts.
Scope: edit the source files the fix needs (skill text, mcp/src, docs), and write, update and run the tests the fix needs. Streamline and deburr first: solve the problem by removing, merging or simplifying what already exists, and consider an addition only once those ideas are exhausted. Anything added must be shorter than the text it makes unnecessary, and that text is deleted in the same change. Out of scope, because the orchestrating session runs them once after every spec lands: `build_plugin.py` and `check_plugin.py`. Out of scope, because `/release` does it: version bumps and rebuilding or committing any MCP bundle (dist/). Never build a `.plugin` archive.

## 9. Open questions
- Should the same rule cover practice directives and guidelines that /localize fetches, or does /localize already fetch them unasked?

## 10. Verify against HEAD before building
Confirm draft/references/unstructured.md §2's current text, where venue.md files record sources, and whether /localize already has a fetch route this could reuse.

### Verification against HEAD (7371fdeb6, 2026-11-27)

| Claim | At HEAD | Where |
|---|---|---|
| §2 step 1 asks the practitioner to save the form | Confirmed, word for word as quoted in §2 | `source/skills/draft/references/unstructured.md:16` |
| The `form-source` gap and `unwritten_gate_failed` refusal | Confirmed. Step 2 links the file as a `documents` row with `role = 'other'` | `unstructured.md:17-19`, `source/skills/drafting-data/references/filing-checklists.md:451` |
| A second ask of the practitioner | Also present: the conversion job asks the form's page address "of the practitioner once when not known" | `unstructured.md:49` |
| venue.md files record sources | No venue.md names a host or URL. Only VanIAC's has front matter (`track`, `sources:` naming `Sources/` records). BCCA and BCSC open with the JSON block. Every venue.md JSON block is validated by a unit test | the three `source/skills/draft/references/CAN/BC/*/venue.md`, `source/lawyer/mcp/test/knowledge-declared-layout.unit.test.mjs:48` |
| Stock `unstructured` type per venue | Confirmed at BCCA, BCSC and VanIAC, each with a `form-source` part | `.../CAN/BC/*/Documents/unstructured.md:10` |
| /localize has a fetch route | Yes. `/localize` already fetches official sources unasked through `sources__fetch`, with `save: true` for a PDF. Only an unlisted host (`host_not_allowed`, then `allow_host` on a yes) or a failed fetch (`fetch_failed`, then the practitioner saves into `_inbox\`) asks the practitioner | `source/skills/localize/references/playbook.md:25-26,47`, `source/skills/localize/SKILL.md:35` |
| Fetch allowlist | `www.bclaws.gov.bc.ca`, `bclaws.gov.bc.ca`, `vaniac.org`, `laws-lois.justice.gc.ca`. `www.bccourts.ca` and `www2.gov.bc.ca` are not on it. The second list is `SOURCES_ALLOWED_HOSTS` in `scripts/check_plugin_bundles.py:13`, not `direct_mode.py` as the header says | `source/lawyer/mcp/src/sources/hosts.ts:7-10,25` |
| Filing a fetched page into the matter | `research_filing__file_fetched` files a page `sources__fetch` fetched into an existing `6. LAW` folder with a manifest record, without a second request. An HTML page is written as `.md`, a PDF as its bytes. A .docx is neither | `source/lawyer/mcp/src/files/research-filing.ts:706-785` |
| Filing a browser download | `research_filing__file_download` copies (never moves) a Downloads file into a `6. LAW` folder. `file_ops__move_from_downloads` is file-manager's | `research-filing.ts:107-135` |
| A test pins §2's wording | None. `source/skills/draft/tests/test_writes_no_job.py` names the file but not §2 | |
