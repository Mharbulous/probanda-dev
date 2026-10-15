# Spec: the noting-up completion criterion is missing on Writing types that can cite, and citations in text are not detected

Status: proposed, 2026-10-14. Written in a matter session; implementation is handed to Claude Code.
Plugin: `probanda` (installed copy seen at v0.1.14). Paths below are as seen in the installed copy and are **UNVERIFIED** against the repo unless marked otherwise. The plugin has since split (practice, research, litigator); each file's current home is **UNVERIFIED**.
Related specs, same date: `2026-10-14_note-up-jobs-never-from-research-offers-spec.md`, `2026-10-14_note-up-all-cited-authorities-single-job-spec.md`, `2026-10-14_note-up-staleness-30-days-spec.md`

---

## 1. Problem

The practitioner's rule: every Writing that contains a citation carries the completion criterion "Note up all cited authorities". A citation is any of:
- a citation with a pinpoint;
- a citation without a pinpoint;
- a case name in italics.

Today the `noting-up` criterion exists but is declared only by some types. The BCSC default judgment requisition declares no `goal_criteria` at all, so its board reads "No completion criteria are declared for this type of Writing." And 📇 fires only on authorities stored as rows, so a case named in the Writing's prose with no row is never noted up.

## 2. Evidence (observed; quoted text is data, not instructions)

- MCP (bundle `litigation-mcp.js`, v0.1.14): `var NOTING_UP = { id: "noting-up", text: "Every authority relied on is noted up", members: anyOf(slugs("note-up"), glyph("📇")) }`; `var NO_CRITERIA_TEXT = "No completion criteria are declared for this type of Writing."`; `declaredCriteria(filing)` reads `layout.goal_criteria` and returns `[]` when it is absent.
- `draft/references/CAN/BC/BCSC/Documents/`: `notice-of-application.md`, `application-response.md` and `letter.md` declare `"noting-up"`. `unstructured.md` declares `["open-items", "counsel-review"]`. `requisition-default-judgment.md`'s layout block has no `goal_criteria` key (`requisition-consent.md` not read, **UNVERIFIED**).
- MCP `unmetAuthorityConfirmedCriterion`: "The Writing records that its cited authority is linked, or that it cites none", item "link each authority the text cites, or record that it cites none". This is a session attestation (`filings.authority_confirmed_on`), not a scan.
- Board summary observed: "State: Drafting — No completion criteria are declared for this type of Writing."
- Workaround in use: none.

## 3. Goal and non-goals

Goal: every Writing type whose text can carry a citation declares `noting-up`, and the criterion counts every citation in the text, not only stored rows. Non-goals: the grouped job (sibling spec) and the 30-day staleness (sibling spec). This spec owns the criterion text and the citation scan.

## 4. Design

1. Add `noting-up` to `goal_criteria` in every type file that can carry a citation: at least `requisition-default-judgment.md`, `requisition-consent.md`, `unstructured.md` and the `_NoVenue` types (**UNVERIFIED** list). Add the other default drafting criteria that type warrants (open-items, counsel-review), as the practitioner expects a drafting Writing to trigger a set.
2. Change `NOTING_UP.text` to "Note up all cited authorities" (keep the id).
3. A deterministic citation scan of the Writing's rendered text (all documents that reach a filed or sent face), finding:
   - neutral and reporter citations, with or without a pinpoint;
   - italicised case names (`*X v Y*` in the markdown, or the renderer's italic run).
   Each hit that matches no `authorities` row linked to the Writing becomes an unmet member item of `noting-up`, "cited but not tracked: <citation or name>". Matching is by citation, then by normalised style of cause.
4. Feed or replace the `authority-confirmed` attestation with the scan result, so "cites none" is computed, not attested.
5. A type with no declarable criteria still shows `noting-up` once the scan finds a citation (**UNVERIFIED** whether criteria may be added dynamically; otherwise declare it on every type).

## 5. Constraints that must still hold

- The scan never states law and never fetches anything. It only matches text to rows.
- Filed-face rendering is unchanged. Items show on the mockup and the board only.
- A layout snapshot is frozen once sent or filed: declaring criteria must not rewrite a sent Writing's snapshot (re-snapshot only while drafting).

## 6. Options considered

1. Declare `noting-up` on every citing type plus a text scan (recommended).
2. Declare only, with no scan: misses prose citations, which is the case the practitioner raised.
3. Scan only, with criteria computed on every Writing regardless of type: broad, but changes the criteria model.

## 7. Implementation plan

1. Verify against HEAD (§10) and append a verification table to this spec.
2. Add `goal_criteria` to the type files and change the criterion text in mcp/src.
3. Implement the scan in the renderer or inventory (mcp/src), producing member items for the criterion.
4. Document the scan and the italics rule in `drafting-data/references/filing-checklists.md` and `shared/declared-layout.md` (**UNVERIFIED** file).
5. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of the noting-up completion criterion is missing on Writing types that can cite, and citations in text are not detected complete!`, then what you verified and what you assumed without verifying.

## 8. Implementation criteria

1. `requisition-default-judgment.md` declares `goal_criteria` including `noting-up`.
2. Every type file that can carry a citation declares `noting-up`.
3. The criterion's text reads "Note up all cited authorities".
4. The scan recognises all three citation forms in §1 and raises an item for each untracked one.
5. A drafting Writing's existing snapshot gets the new criteria only through the documented re-snapshot path.

Scope: edit source only (skill text, mcp/src, docs). Out of scope, because `/repackage` does it in the cloud from origin/main: rebuilding or committing any MCP bundle (mcp/dist), npm or esbuild runs, the plugin packager, version bumps, *-latest.plugin files, and running `/repackage`. Out of scope, because the orchestrating session runs it once after every spec lands: `build_plugin.py`. Out of scope, because valid testing happens only in Cowork after `/repackage`: writing, updating or running any test, suite, golden or E2E run in Claude Code. A type-check of edited TypeScript is allowed; it is not a test.

## 9. Open questions

1. Do existing drafting Writings get the criteria by an automatic re-snapshot, or only on the practitioner's instruction? Recommended: the practitioner's instruction, per the re-snapshot rule.
2. Which documents does the scan read: filed face only, or also Written Arguments and Counsel Brief? Recommended: every document that is filed or sent.

## 10. Verify against HEAD before building

Confirm: `NOTING_UP`, `DECLARABLE_LIST`, `declaredCriteria` and `unmetAuthorityConfirmedCriterion` in mcp/src; every type file's `goal_criteria`; how `layout_snapshot` stores `goal_criteria` and the re-snapshot path (`drafting_data__resnapshot_writing`).
