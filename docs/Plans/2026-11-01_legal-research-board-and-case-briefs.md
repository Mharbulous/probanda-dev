# Legal Research board and case briefs

Status: approved 2026-11-01. Replaces the Legal Memos page (docs/Specs/2026-10-31_legal-memos-board.md) with one view page holding three tabs, and makes the case brief a structured Writing like the research memo. Terms: GLOSSARY.md, **Case brief** and **Legal memo**.

## Decisions taken

- **One page, "Legal Research"** (`Legal Research.html`), one per board holding a live Writing, beside the Milestone page. Three folder tabs as on the Arguments page, no All tab, the last tab remembered: Propositions, Case Briefs, Legal Memos.
- **Propositions** is the Raw Research view as at b5939336 (its classes, groups, search and two checkboxes), with undecided shown by default, because holding propositions not yet placed is the tab's purpose. Its counts and filters move inside the tab. Statements that belong to memo and brief Writings are left out, so the tab is not filled with research output.
- **Legal Memos** is the board built on 2026-10-31, unchanged, except that case briefs are excluded.
- **Case Briefs** lists the cases the board's Writings rely on: each case authority behind a statement of law in use on any of the board's Writings, one row per case (parallel citations folded by neutral citation). Each row shows **Briefed** (with a link to the brief file and its version), **Requested** (a live brief job names the case) or **Not briefed**. A brief saved without a job matches its case by the neutral citation in its file name. A brief of a case no Writing relies on yet is listed below them.
- **A case brief is a structured Writing** of a new kind, with the parts Case, Facts, Procedural history, Issues, Holding, Ratio decidendi, Obiter dicta and Disposition, one numbered paragraph per item. Holding and ratio items cite the decision at a pinpoint as statements of law, as a memo's items do. It names nothing of the working matter, with no exception: a brief is always of someone else's case, read to compare with the matter, so a decision in the matter's own litigation is never briefed. The request step skips such a decision, and the brief reviewer rejects a brief of one, saying Probanda has mistaken what a case brief is. It is saved in `6. LAW`, in the decision's own folder, as `YYYY-MM-DD case brief <style of cause>, <citation>.md`. Every saved version is the same brief.
- **Requests are made only when the practitioner asks**: "brief the cases Milestone 1 relies on" creates one job per Not briefed case, and naming a case creates one. Title `Brief the case: <style of cause>, <citation>`, the case's authority in scope, fixed steps (get the decision, brief it, save it under the job). One live brief job per case per proceeding.
- **Who writes it**: holding, ratio and obiter are statements of law, so the research agent writes the brief in a new case-brief mode, and a new read-only brief reviewer checks it before it is saved: each item is the court's own voice at a pinpoint, ratio and obiter correctly told apart, and nothing of the working matter named.
- **Read paths**: propositions through `/drafting-data` as before; memos through `drafting_forms__board_card`'s `memos` lane; case briefs through a new `briefs` lane on the same tool, printed from the same reader as the tab.
- **Rename**: the next page write moves `Raw Research.html` and `Legal Memos.html`, their `- Milestone <id>` variants and their previews, to TRASH. A viewed thumbnail of either keeps its place. The html-pages hook refuses all three names.
- **Memo and brief Writings get no board of their own** (practitioner, 2026-11-01). They get no Milestone page and no view pages, and the next page write moves any they already have to TRASH. A memo or brief saved under a job is linked to that job's board and listed on its Legal Research page. One saved with no job has no board, and is listed only by the Legal Memos rule 2 and the Case Briefs citation match.
- **No schema change.** Released as patches.

## Build, in order

1. **lawyer: the page.** `legal-research-page.ts` registers the page and composes three readers: the restored propositions reader, `buildLegalMemosData` (briefs excluded), and a new case-briefs reader over the drafting database, the board's jobs and the `6. LAW` file names. Templates `legal-research.{html,css,js}` from `view-folder.css` and the existing two scripts. The `briefs` lane. Memo and brief Writings left out of the page build (no Milestone, no view pages). Rename sweep, viewed-key alias, hook names, fixture, tests.
2. **researcher and shared: the brief.** Type file `case-brief.md` and its kinds row; `shared/case-brief-template.md` (the shape, the single source); the persist steps beside the memo's in `shared/legal-research.md`; the research agent's case-brief mode; the `brief-reviewer` agent; `/case-brief` rewritten to produce the Writing (model-invocable so `/work` can hand it a job), keeping its offer to save the decision to case data; the brief file name added to the skip patterns that find a decision by its citation, so a brief is never taken for the decision.
3. **litigator and lawyer server: the jobs.** The fixed-text create in `drafting-data` (jobs-stock and jobs-create), the `/work` hand-off row, the Complete step's brief check in place of the Issue check, brief jobs kept out of research board mode; in the server, the brief title among `take_job`'s fixed texts and a one-per-case create guard.
4. Tests for each part, `/release`.

## Left for later

- A matter with no live Writing has no Legal Research page. Case briefs and memos with no job are matter-wide, so a per-matter page, like Loose Threads, may serve the research phase better.
- `docs/Specs/2026-10-31_research-memo-structured-writing-spec.md` (proposed) would change where memo propositions live; the Propositions tab's exclusion of memo statements follows it.
- The session focus pointer stays Arguments-only: its file is keyed by Writing, so a second page would collide.
