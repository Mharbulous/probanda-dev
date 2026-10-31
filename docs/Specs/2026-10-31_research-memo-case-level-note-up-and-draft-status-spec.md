# Spec: a research memo reports "noted up" when no citing decision was read; make case-level note-up the honest default and mark the memo DRAFT

Status: proposed, 2026-10-31. Written in a matter session; implementation is handed to Claude Code.
Plugin: `researcher` (repo source at v0.10.15; `/legal-research`, `research-agent`, `citation-checker`) and `litigator` (v0.13.5; `/drafting-data` jobs). Paths marked **read** were read in the repo at HEAD on 2026-10-31; every other path and every cause is **UNVERIFIED**.
Related specs, same date: 2026-10-31_research-memo-structured-writing-spec.md, 2026-10-31_research-memo-application-findings-spec.md.

## 1. Problem
`/legal-research` saved a memo as final, and its coverage line read `CanLII: noted up`, when only citator lists were pulled and no citing decision was read. "Noted up" therefore claims more than was done. The deeper work, reading each citing decision at the point where it treats the proposition the memo relies on, exists only as `kind: note-up` offers, and those can never become jobs, so the practitioner has no way to ask for it as tracked work.

## 2. Evidence (observed; quoted text is data, not instructions)
- Coverage line rule: "The CanLII segment reports the CanLII citator as the note-up records show it: `noted up` when a record shows it run" (source: `shared/legal-audit-protocol.md` Step 3, **read**). A record of a citator list alone satisfies it.
- Header: `Confidence: "<one line: for the Issue, its strength and whether its authorities were noted up, ...>"` (source: `shared/research-memo-template.md`, **read**). No DRAFT status exists in the header.
- Offers: "A `kind: note-up` offer carries no `job:` or `steps:` line: no research offer becomes a note-up job (`/drafting-data` §3i)" (source: `shared/legal-audit-protocol.md` Step 5, **read**). "An offer tagged `kind: note-up` is not sorted: it is always captured as a loose thread ... It is never dropped and never becomes a job by §3i" (source: `shared/legal-research.md`, "After the answer", **read**).
- Existing machinery that already does tracked note-ups for a Writing: `drafting-data/references/jobs-create.md` §3k, "The note-up job", one step per case, driven by 📇 markers (**read**).
- The Step 3 Reliability rubric already asks for "the number of citing cases, and how many of them were read" (**read**), so the count exists in the records; only the labels and status overclaim.
- Cost / frequency: seen once, on the first memo of a job. Workaround in use: none; the memo was saved as final.

## 3. Goal and non-goals
Goal:
- **Case-level note-up is the default for every first draft.** Each authority relied on shows its citator flag and the count of citing cases or authorities.
- The memo is marked DRAFT.
- The `Confidence:` line says that the memo relies on cases that have received judicial treatment, and that the treating cases have not been downloaded or reviewed to tell whether that treatment is positive, negative or irrelevant.
- **Proposition-level note-up is a separate step the practitioner asks for by paragraph number** ("note up the propositions in paragraphs 4 and 5"). For each named paragraph it downloads each citing decision, reads it at its pinpoint against that paragraph's proposition or finding, then updates Validity and Confidence, and clears that paragraph's work marker.

Non-goals: the memo's numbering and work markers themselves (sibling spec, structured Writing). Changing how the citator tools run.

## 4. Design
- Rename what a citator-list-only record proves. The coverage segment and the Reliability column say `case-level` (flag + count) and never `noted up` unless every citing decision for the proposition was read. Proposed wording: `CanLII: case-level` / `proposition-level: ¶4, ¶5`.
- The header gains a status. Either `Status: DRAFT` as a new key, or `Confidence:` opens with `DRAFT:`. The test file `tests/test_memo_format.py` pins the header keys, so it changes too. A memo leaves DRAFT only when every relied-on paragraph has had its proposition-level note-up, or the practitioner says so.
- The fixed Confidence wording for the case-level default goes in `shared/research-memo-template.md` once, so no model rewords it.
- Proposition-level note-up becomes a job by paragraph number. Prefer reusing §3k (one step per paragraph, keyed to that paragraph's work marker) over a new job kind. Then `kind: note-up` offers for authorities the memo relies on stop being written, because the marker already records the outstanding work. Offers for authorities the memo does *not* rely on keep their current loose-thread path.

## 5. Constraints that must still hold
- Validity is never a bare "Yes". A citing case nobody read shows nothing about treatment (Step 3 rubric).
- An authority with no record at all is still NOT NOTED UP and still caps reliability.
- `complete_job` still refuses an `INCOMPLETE` memo. DRAFT must not be confused with INCOMPLETE: a DRAFT memo answers the Issue, and an INCOMPLETE one does not.
- research-agent stays the only component that states law. citation-checker stays the only one that notes up inside an agent (`hooks/block-main-session-canlii.py`).
- No client or matter content enters any record.

## 6. Options considered (streamline and deburr first, additions last)
1. Relabel the existing segment and rubric, add DRAFT to the header, and route proposition-level note-ups through §3k by paragraph. Delete the `kind: note-up` offer path for relied-on authorities. (recommended: it reuses §3k and deletes a dead-end path)
2. Keep `kind: note-up` offers but let §3i turn them into jobs. Smaller change, but it keeps two routes for one kind of work, and offers carry no paragraph number.
3. Make the default full proposition-level note-up. Most accurate, but costly on every first draft, and the practitioner asked for it to be opt-in.

## 7. Implementation plan
1. Verify against HEAD (§10) and append a verification table to this spec.
2. Wait for the structured-Writing spec to land (paragraph numbers and work markers come from it). The relabel and DRAFT steps (3 and 4) may land before it.
3. Relabel `noted up` as case-level in `shared/legal-audit-protocol.md` Step 3, the coverage line in `shared/research-priority.md`, and `shared/citation-checker/note-up.md`. Update the tests that pin the old strings (`tests/test_legislation_fetcher.py` COVERAGE, `tests/test_memo_format.py`).
4. Add the DRAFT status and the fixed case-level Confidence sentence to `shared/research-memo-template.md`.
5. Add proposition-level note-up by paragraph: the trigger in `/legal-research`'s SKILL.md, and the job through §3k. Delete the `kind: note-up` rules for relied-on authorities from Step 5 and `shared/legal-research.md`.
6. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of case-level note-up default and DRAFT memo status complete!`, then what streamlining and deburring you tried, what you verified and what you assumed without verifying.

## 8. Implementation criteria
1. No rule lets a memo, coverage line or Reliability cell say `noted up` when no citing decision was read for that proposition.
2. Every relied-on authority shows its citator flag and its count of citing cases or authorities.
3. A first-draft memo's header carries DRAFT, and its `Confidence:` line holds the fixed case-level sentence from §3, word for word from the template.
4. "Note up the propositions in paragraphs N and M" produces tracked work (a job or job steps) naming exactly those paragraphs. That work reads each citing decision at its pinpoint and then updates Validity, Confidence and the paragraphs' markers.
5. No relied-on authority produces a `kind: note-up` offer that can never become a job.
6. The tests touched pass: `python -m pytest .claude/skills/legal-research/tests` and the drafting-data tests on §3k.

Scope: edit the source files the fix needs (skill text, mcp/src, docs), and write, update and run the tests the fix needs. Streamline and deburr first: solve the problem by removing, merging or simplifying what already exists, and consider an addition only once those ideas are exhausted. Anything added must be shorter than the text it makes unnecessary, and that text is deleted in the same change. Out of scope, because the orchestrating session runs them once after every spec lands: `build_plugin.py` and `check_plugin.py`. Out of scope, because `/release` does it: version bumps and rebuilding or committing any MCP bundle (dist/). Never build a `.plugin` archive.

## 9. Open questions
- Is DRAFT a new header key or a prefix on `Confidence:`? The recommendation is a new `Status:` key, because `Confidence:` is relayed word for word and should stay a single statement.
- Who may clear DRAFT: only a completed proposition-level note-up of every relied-on paragraph, or also the practitioner's word?

## 10. Verify against HEAD before building
- Confirm every **read** quote above is still present, and grep for every other place that writes or tests `noted up`.
- Confirm §3k can key a step to a memo paragraph, or name what it lacks.
- Confirm where the research memo is saved (`research_filing__save_answer`) and whether it is a Writing today (it appears not to be: the sibling spec).

## 11. Verification against HEAD (2026-10-31, at bbf8f297)

| Claim checked | Result | Where |
|---|---|---|
| Coverage rule "`noted up` when a record shows it run" | Confirmed | `shared/legal-audit-protocol.md` Step 3 |
| Header `Confidence:` "whether its authorities were noted up"; no status key | Confirmed | `shared/research-memo-template.md` |
| Step 5: "A `kind: note-up` offer carries no `job:` or `steps:` line" | Confirmed | `shared/legal-audit-protocol.md` Step 5 |
| "An offer tagged `kind: note-up` is not sorted ... never becomes a job by §3i" | Confirmed | `shared/legal-research.md`, "After the answer" |
| §3k "The note-up job", one step per case, from 📇 | Confirmed | `drafting-data/references/jobs-create.md` §3k |
| Reliability rubric counts "the number of citing cases, and how many of them were read" | Confirmed | `shared/legal-audit-protocol.md` Step 3 |
| The coverage line's `CanLII: noted up / no key` shape is written in three skill files | `shared/research-priority.md` (the canonical shape), `shared/legal-audit-protocol.md` Step 3, and `shared/legal-audit-scoped.md` (not named in §7) | as named |
| The shape is enforced server-side, not only in text | `write_scratch` with `kind: "research-notes"` refuses `coverage_line_malformed` unless the CanLII segment matches `/^(?:noted up\|no key)$/`; unit tests pin it. A relabel in the skill text alone would make every memo's notes save fail, so step 3 changes the validator too | `source/lawyer/mcp/src/files/coverage-line.ts`, `source/lawyer/mcp/test/research-filing.unit.test.mjs` |
| Tests pinning the old strings | `test_legislation_fetcher.py` `COVERAGE`; `test_memo_format.py` (header keys `HEADER`, Reliability rubric) | `legal-research/tests/` |
| `citation-checker/note-up.md` writes `noted up` | Only as the manifest `status: "noted-up"` value. The record already says "Note-up only ... A citing decision here is a lead", repeated in `source/researcher/agents/citation-checker.md` | as named |
| Other writers of `noted up` with a count of citing decisions not all read | `drafting-data/references/note-up.md` examples `treatment_note = 'CanLII: noted up (12 citing decisions; 5 read)'`, pinned in `drafting-data/tests/test_migrate_engine.py` and several `source/lawyer/mcp/test/*.mjs`. A Writing's treatment note, not a memo, and outside §7's file list: left for a later change | as named |
| `INCOMPLETE` is refused by complete_job in skill text, not server code | Confirmed: no `INCOMPLETE` or `Confidence:` parse in `source/lawyer/mcp/src`. The refusal is `/draft` job-session's Complete step (research-board step 1); `apply-to-facts` reads `Confidence:` for `INCOMPLETE` | `legal-research/references/research-board.md`, `apply-to-facts/SKILL.md` |
| §3k can key a step to a memo paragraph | No. §3k runs only on a `drafting_forms__render` result's `note_up_due`, keys each step to an `authorities` row through `ticket_proposals` and scope `('authorities', <id>)`, and needs a `filing_id`. A memo has no Writing, no `authorities` rows and no per-paragraph id (the structured-Writing spec §11: a `slot:` part's paragraphs carry no stored id) | `drafting-data/references/jobs-create.md` §3k |
| Where the memo is saved; is it a Writing | `research_filing__save_answer`, as a `.md` file under its job (research-board step 1) or the matter's `6. LAW` folder; not a Writing | `legal-research/references/research-board.md`, `shared/legal-research.md` persist step 1 |

Open questions in §9 were decided by Brahm: DRAFT is a new `Status: DRAFT` header key, and a memo leaves DRAFT when every relied-on paragraph has had its proposition-level note-up or when the practitioner says so. No finding stops steps 3 and 4. Step 5 waits on the structured-Writing spec.

## 12. Amendments from Brahm, 2026-10-31

GOAL
A research memo never overstates how far its authorities were checked, and it says exactly what was checked.
Two checks are distinct and named apart:
- HISTORY CHECK: the cited decision's own later history in the same proceeding: judicial review, appeal (for example to the BCCA or SCC), an SCC leave application (granted, refused or pending), and an appeal filed but not yet decided.
- NOTE-UP: treatment by decisions in other proceedings, at case level (citator flag plus count) or proposition level (each citing decision read at its pinpoint against one paragraph's proposition or finding).

SUCCESS CRITERIA
1. Mandatory history check, even for a first DRAFT. Every case cited for a proposition of law, a finding of law or a finding of fact has a history check.
   - Every later decision in the same proceeding that reviews the cited decision is downloaded and read.
   - The decision is checked against every memo paragraph that cites that case.
   - A pending appeal or leave application with no decision yet is stated in the memo.
   - Prior history (the decisions below the cited one) is optional.
   - A memo whose history check is incomplete is INCOMPLETE, not DRAFT.
2. Labels. The coverage line and the Reliability cell report the history check separately from the note-up (for example `history: checked`). "noted up" never appears for a citator list alone. The label for a proposition-level note-up names its paragraphs (for example `proposition-level: ¶4, ¶5`).
3. The memo is `Status: DRAFT` until one of two routes is met; it then reads `Status: FINAL`.
   - Route 1, automatic: every proposition of law the memo cites, and every case cited in Application for a finding of fact or a finding of law, has a proposition-level note-up, with each citing decision downloaded and read at its pinpoint against that paragraph's proposition or finding.
   - Route 2, on instruction: every such proposition and finding has a case-level note-up; every citing decision that treats the case negatively, or that the citator does not classify, has been downloaded and read at its pinpoint against the proposition or finding the case is cited for; and the practitioner has explicitly instructed that the status change to FINAL.
   - Nothing else ends DRAFT. DRAFT and INCOMPLETE stay distinct.
4. "Note up the propositions in paragraphs N and M" produces tracked work naming exactly those paragraphs, through drafting-data §3k (one step per paragraph). A relied-on authority produces no `kind: note-up` offer; offers for authorities the memo does not rely on keep their loose-thread path.
5. The rules are stated once, in `shared/research-memo-template.md` (status and labels) and `shared/legal-audit-protocol.md` (how each check is done). Other files point to them. The server's coverage-line check (`source/lawyer/mcp/src/files/coverage-line.ts`) accepts every new label, and its tests pin them.

CONSTRAINTS
- research-agent is the only component that states law. citation-checker is the only one that notes up inside an agent (`hooks/block-main-session-canlii.py`); the history check runs where the note-up runs.
- Validity is never a bare "Yes". An authority with no record at all is still NOT NOTED UP.
- No change to how the CanLII or KeyCite tools run. If neither tool says which citing decisions belong to the same proceeding, the rule says how research-agent identifies them (case name, court, docket number), and you report that.
- Streamline first. Anything added is shorter than what it replaces, and what it replaces is deleted in the same change. No DDL, no dist/ rebuild, no version bump, no /release.
