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
2. Which documents does the scan read: filed face only, or also Written Arguments and the never-delivered brief? Recommended: every document that is filed or sent.

## 10. Verify against HEAD before building

Confirm: `NOTING_UP`, `DECLARABLE_LIST`, `declaredCriteria` and `unmetAuthorityConfirmedCriterion` in mcp/src; every type file's `goal_criteria`; how `layout_snapshot` stores `goal_criteria` and the re-snapshot path (`drafting_data__resnapshot_writing`).

## 11. Verification against HEAD (2026-10-14, at 99b0274)

| Item | Spec said | HEAD shows |
|---|---|---|
| `NOTING_UP` | `{ id: "noting-up", text: "Every authority relied on is noted up", members: anyOf(slugs("note-up"), glyph("📇")) }` | Confirmed, in `source/practice/mcp/src/submission/forms/render-work-board.ts`. |
| `DECLARABLE_LIST` | not quoted | Same file. Every declarable criterion but `open-items`, whose members `openItems()` derives from what else is declared. `noting-up` is in it. |
| `declaredCriteria` | reads `layout.goal_criteria`, `[]` when absent | Confirmed. It reads the stored `layout_snapshot`, not the type file, so a type file change reaches a Writing only through its snapshot. A name outside the vocabulary fails hard. |
| `NO_CRITERIA_TEXT` | "No completion criteria are declared for this type of Writing." | Confirmed. `goalFor` returns it, with no criteria and a pending goal, when `declaredCriteria` is empty. Criteria cannot be added at render time: the card has no gate row without a declared criterion. So §4.5 takes its fallback, declaring `noting-up` on every type. |
| `unmetAuthorityConfirmedCriterion` | session attestation on `filings.authority_confirmed_on` | Confirmed, in `render-work-board.ts`. It reads `authorityUnconfirmed` (`render-general.ts`): an unsent Writing with no forum parts that declares `primary-authority` and has `authority_confirmed_on` NULL. The pre-send hold (`sent-write.ts`) and the Milestone's pre-send gate row both read it. Every type that declares `primary-authority` also declares `noting-up`. |
| Type files' `goal_criteria` | requisition-default-judgment has none; requisition-consent unread | Type files are under `.claude/skills/draft/references/CAN/BC/`. With no `goal_criteria`: BCSC `requisition-default-judgment`, BCSC `requisition-consent`, BCCA `respondent-factum`, BCCA `stay-response-book`, VanIAC `submissions-package`. Declaring criteria without `noting-up`: the three venue `unstructured` types (`open-items`, `counsel-review`), the seven `_NoVenue` `unstructured-<recipient>` types (`recipients`, `open-items`, `counsel-review`) and `_NoVenue` `release`. Every letter type, `internal-memo`, `notice-of-application` and `application-response` already declare `noting-up`. The `publish` tree's `Documents/` files are not Writing type files and declare no layout block. |
| `/localize` new types | not mentioned | `localize/references/playbook.md` step 5 gives a learned `_NoVenue` type `["recipients", "open-items", "counsel-review"]` and a venue type its stock `unstructured` type's criteria. |
| How `layout_snapshot` stores `goal_criteria` | not quoted | `filings.layout_snapshot` holds `{layout, venue, passage_hashes, type_file, venue_file}`; `goal_criteria` sits in `layout` as the type file declared it at creation (`writing-snapshot.ts`). |
| Re-snapshot path | `drafting_data__resnapshot_writing` | Confirmed (`writing-snapshot.ts`, `resnapshotWriting`). It refuses a sent, filed or retired Writing (`writing_not_drafting`) and is called only on the practitioner's instruction (`draft/references/present-files.md`, Layout confirmation). §9 question 1's recommendation holds with no code change. |
| Where a scan can read rendered text | "the renderer or inventory" | `forms.ts`'s mockup render builds every document (`documentsForFiling`), then writes the render manifest with `ctx.inventory`, then builds the Milestone from that inventory. The Sent write's hold reads the inventory back from the manifest (`latestInventory`). `toFiledFace` gives each document's filed face. A scan that appends inventory entries before the manifest is written reaches the board, the manifest and the pre-send hold. Documents that reach the forum are those outside `NEVER_DELIVERED_DOCS` (`Counsel_brief`, `practice_board`): the venue document(s) and Written Arguments, so §9 question 2's recommendation (every filed or sent document) is workable. |
| "linked to the Writing" | match against `authorities` rows linked to the Writing | Statement lines print from many renderers (general header, VanIAC/BCSC statement lines, BCCA factum and book tables), and not all of them carry a `statement_of_law_id` trace, so a printed citation cannot always be tied back to a row from the text alone. The scan matches against every live (not killed) `authorities` row of the Writing's proceeding. A citation the renderer printed from a row always matches its own row, and once a row exists its noting up is 📇's. |
| Schema | — | The scan needs no column or table: it reads `authorities` and adds inventory entries only. |
