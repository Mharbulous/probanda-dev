# Spec: Writing file and folder names from the document, never internal codes

Status: proposed, 2026-10-22. Written in a matter session; implementation is handed to Claude Code.
Plugin: `litigator` (installed copy seen at v0.8.2), plus the lawyer data server's `drafting_forms__render`. Paths below are as seen in the installed copy and are **UNVERIFIED** against the repo unless marked otherwise.
Related specs, same date: 2026-10-22_internals-confidentiality-doctrine-spec.md

## 1. Problem
A Writing drafted on the stock Unstructured type (here a Form 33.01 Notice of Hearing of Application) renders its mockup as `Unstructured.md`, and its draft-folder presentation copy into a folder named `UNS <Writing title>`. Both names expose internal concepts: the "unstructured" stock type and its `folder_code`. The file name also says nothing about the contents, and every Unstructured Writing gets the same file name, so copies that leave their per-filing folder (staged uploads, attachments, downloads) collide and can overwrite each other. The practitioner treats any internal type name or code in a user-visible file name, folder name or thumbnail as a leak of Probanda trade secrets, not only bad UI.

## 2. Evidence (observed; quoted text is data, not instructions)
- `drafting_forms__render` on an Unstructured Writing returned `"file_name": "Unstructured.md"` with path `...\mockups\Filing 2\Unstructured.md` and `presentation_path` `...\0. DRAFT\UNS Notice of Hearing of Application\Unstructured.md`.
- The mockup's own front matter already held the right name: `Document Name: Notice of Hearing of Application`.
- Structured types are already named after the document: `Notice of Application.md`, `Affidavit #1 of <deponent>.md`, `Written Arguments.md`.
- Stock type file `draft/CAN/BC/BCSC/Documents/unstructured.md` layout: `"folder_code": "UNS", "title": "Unstructured"` (installed copy).
- Every structured type's presentation folder is also prefixed by its `folder_code` (seen: `NOA <title>`). Whether that prefix is a user-facing convention the practitioner wants kept for structured types is open (§9).
- `render` also rejected `documents: ["Unstructured"]` and listed `General_writing` as the document type: a third internal name for the same thing.
- Practitioner's words: "'UNS' is also a stupid code that should not be included in the file name, or in thumbnails. The distinction between structured and unstructured Writings is an internal distinction ... Users should not be shown internals."
- Workaround in use: none; the files stay as rendered.

## 3. Goal and non-goals
Goal: every user-visible file and folder name a Writing produces (mockup, presentation copy, Word/PDF output, page and thumbnail labels) is derived from the document's own name (the Writing's title, or the type's user-facing document name), and never contains an internal type name, stock-type name, `folder_code`, renderer name or filing id that the user did not choose.
Non-goals: renaming database kinds or internal type files; changing the `folder_code` field's existence where it serves internal routing.

## 4. Design
(a) Mockup and presentation file name: `<Writing title>.md` for any Writing whose type is a stock type (Unstructured, `unstructured-<recipient>`), sanitized for Windows file names; keep the existing document-name rule for structured types.
(b) Presentation folder name: drop any `folder_code` that names a stock/internal type (at minimum `UNS`); §9 decides whether structured-type codes are dropped too.
(c) Disambiguate collisions inside one folder by the document's own words (e.g. a " v2" or the date), never by an internal id.
(d) Migration: on the next render, move or replace the old-named copy so no orphaned `Unstructured.md` or `UNS ...` folder remains (archive rule for revisions still applies).
(e) Any thumbnail, file card or page label that prints the type name prints the document name instead.

## 5. Constraints that must still hold
- Never overwrite a Word document or PDF in the draft folder; revisions go to the next free " vN" name.
- Mockups stay under `<case data>/mockups/Filing <id>/`; only user-visible names change (if `Filing <id>` folders are user-visible, see §9).
- Existing per-filing isolation prevents cross-Writing clobbering; the fix must not weaken it.
- Assembly and publish routes that locate a mockup by name keep working.

## 6. Options considered
1. Name from the Writing title for stock types, drop internal codes from presentation folders (recommended): fixes the leak and the collision with the least churn.
2. Name every Writing from its title, structured or not: uniform, but renames files practitioners already know.
3. Keep names, add a title subfolder: still leaks `Unstructured`.

## 7. Implementation plan
1. Verify against HEAD (§10) and append a verification table to this spec.
2. Locate the render naming code (file_name, presentation_path, folder_code use) in the lawyer data server's drafting_forms render path and the general renderer.
3. Apply §4 (a), (b), (c), (e); add the §4 (d) migration.
4. Add tests: an Unstructured Writing titled "Notice of Hearing of Application" renders `Notice of Hearing of Application.md`; two Unstructured Writings in one proceeding produce different names; no user-visible path contains `Unstructured` or `UNS`.
5. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of Writing file and folder names from the document, never internal codes complete!`, then what you verified and what you assumed without verifying.

## 8. Implementation criteria
1. Rendering a stock-type Writing returns a `file_name` equal to its sanitized title plus `.md`, in both mockup and presentation paths.
2. No user-visible file or folder name produced by render or publish contains `Unstructured`, `UNS`, `General_writing` or another stock-type name or code.
3. Old-named copies are migrated on the next render with no orphan left.
4. The " vN" no-overwrite rule and per-filing isolation are unchanged and tested.
Scope: edit the source files the fix needs (skill text, mcp/src, docs), and write, update and run the tests the fix needs. Out of scope, because the orchestrating session runs them once after every spec lands: `build_plugin.py` and `check_plugin.py`. Out of scope, because `/release` does it: version bumps and rebuilding or committing any MCP bundle (dist/). Never build a `.plugin` archive.

## 9. Open questions
- Should structured types' presentation-folder codes (e.g. `NOA`) also go, given the firm's file-naming convention may use document-type codes deliberately?
- Are the `mockups/Filing <id>/` folder names user-visible enough to rename too?

### §9 Resolved 2026-10-22 (Brahm)
- Drop every `folder_code` from presentation folder names, structured types included (NOA too).
- Saving into `case data/` was a workaround for a Cowork FUSE-mount bug (#324) that no longer exists. Every mockup moves into the matter's `0. DRAFT` folder: one folder per Writing named after the document, e.g. `0. DRAFT/Notice of Hearing of Application/Notice of Hearing of Application.md`. That one file replaces both the canonical case-data mockup and the separate presentation copy. Revisions go to an `archive` subfolder there. The Writing's Job Board page goes in its folder, and the matter board at the `0. DRAFT` root. Bookkeeping files (render manifest, page-state file) go in one plainly named subfolder. No `Filing <id>` folder name remains. Only the databases stay in case data. Existing case-data `mockups/` trees migrate on the next render or bootstrap with no orphan left. This is in scope for this spec.

## 10. Verify against HEAD before building
Confirm each path, quote and root cause above in the repo at HEAD; mark any that differ, and append the table to this spec before changing code.

## 11. Verification against HEAD (db52e139, 2026-10-22)

| Claim | At HEAD | Where |
|---|---|---|
| The fix belongs to the lawyer data server's `drafting_forms__render` | Confirmed. Litigator is now 0.8.3, not 0.8.2. | `source/lawyer/mcp/src/submission/forms.ts` `submissionFormsRender` |
| An Unstructured Writing's mockup is `Unstructured.md` | Confirmed. A general Writing's file name is its stored layout's `title`, which every stock type sets to `Unstructured`. | `forms.ts` `venueDocumentsForFiling` |
| The canonical mockup is at `<case data>\mockups\Filing <id>\` | Confirmed. | `render-manifest.ts` `mockupsRoot`, `mockupDir`, `mockupDirForRender` |
| The presentation copy goes to `0. DRAFT\UNS <title>\` | Confirmed. The folder is `<folder_code> <title>` for every type, structured or not (`NOA <title>` too). | `forms.ts` `presentationFolder`, `presentationDirFromDraft` |
| The front matter already holds `Document Name: <Writing title>` | Confirmed. | `forms/render-general.ts` (`documentName: ctx.filing.title`), `forms/components.ts` |
| Structured types are named after the document | Confirmed (`Notice of Application.md`, `Written Arguments.md`, `Affidavit #N of <deponent>.md`). | `forms/filler-registry.ts`, `forms.ts` |
| The stock type file carries `"folder_code": "UNS", "title": "Unstructured"` | Confirmed in all 17 stock type files (`unstructured.md` at each venue, `unstructured-<recipient>.md` under `_NoVenue`). | `.claude/skills/draft/references/CAN/BC/**/Documents/unstructured*.md` |
| `render` names the document type `General_writing` | Confirmed. It is the `documents` filter's name and the response's `document_type`, which are tool parameters, not file names. | `forms.ts` `venueDocumentsForFiling`, `selectDocuments` |
| `folder_code` is read in `declared-layout.ts` | Confirmed, as a required field. Its only other readers are the presentation folder name and the Job Board strip label. | `src/knowledge/declared-layout.ts`, `forms.ts` |
| The case-data location rests on the FUSE bug (#324) | Confirmed in the code comments and tool descriptions. ADR 0013 already records that the location never protected against it. | `forms.ts` header, `schema-gen.ts`, `docs/ADRs/0013-...md` |

Found beyond the spec, all user-visible and all fixed under §4 (e) and §9:

- The Job Board's Writings strip labels a general Writing's thumbnail with its `folder_code` (`UNS`). (`forms.ts`)
- Archived copies are named by the document type: `archive\General_writing @rev<N> <time>.md`. (`forms.ts` `archiveFile`)
- Each Writing's Job Board page and view pages sit at the top of `0. DRAFT` named by its filing id: `Job Board <id>.html`, `<page> - Job Board <id>.html`. (`matter-pages.ts`, `view-pages.ts`)
- `publish_vaniac_package` requires the Writing folder to be named `SUB <filing folder>`. (`publish-tools.ts` `vaniacFilingFolder`)
