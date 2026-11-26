# Spec: a rebuttal takes its argument's number, with no letter unless the argument has several rebuttals

Status: proposed, 2026-11-26. Written in a matter session; implementation is handed to Claude Code.
Plugin: `lawyer` data server (matter pages) and `litigator` drafting-data docs (installed copies seen at lawyer v0.33.0, litigator v0.29.0). Paths below are as seen in the installed copy and are **UNVERIFIED** against the repo unless marked otherwise.
Related specs, same date: `2026-11-26_rebuttals-strip-hollow-buttons-for-missing-spec.md`

---

## 1. Problem

On the Arguments page's Rebuttals tab, every rebuttal is still labelled with its argument's number plus a letter ("REBUTTAL #22.A", "#23.A", "#24.A" ... "#45.A"), even where it is the argument's only rebuttal. The practitioner's numbering (2026-11-25): "Argument #1 <- Rebuttal #1.a, Argument #1 <- Rebuttal #1.b, Argument #2 <- Rebuttal #2." A letter appears only when one argument has more than one rebuttal. The practitioner also ruled (2026-11-26) that the argument-to-rebuttal relation is one-to-one per rebuttal: each rebuttal answers exactly one argument, and identical rebuttal text on different arguments is allowed.

## 2. Evidence (observed; quoted text is data, not instructions)

- Screenshot of the Rebuttals tab after a render on 2026-11-26 13:55: number strip "22.a 23.a 24.a 25.a ... 41.a 41.b 42.a 43.a 44.a 45.a"; card badges "REBUTTAL #22.A", "REBUTTAL #23.A", "REBUTTAL #24.A". Only argument 41 has two rebuttals.
- Rule text the page follows, as quoted in an earlier session: "labelled by its lowest-numbered target plus a letter in link order ("#2.a" ...), and each other target shows "see #2.a"" (source: `shared/html-pages.md`, Arguments). And: "one rebuttal may answer several and one argument may have several" (source: `drafting-data/references/filing-checklists.md`); "argument ─ rebuts → argument ×N # `argument_rebuts` (v82), many-to-many" (source: `drafting-data/references/terms-and-symbols.md`).
- An earlier /fix-this block (2026-11-26, single-block, not saved as a spec) asked to make the relation one-to-one (link as a column, split N-target rebuttals, drop "see #N.a"). Its status is **UNVERIFIED**; the installed page still letters every rebuttal.
- Workaround in use: duplicate rebuttal rows with copied text were added so some arguments have their own rebuttal; they still render with ".a".

## 3. Goal and non-goals

Goal: a rebuttal's label is its argument's number ("#24"); when an argument has two or more live rebuttals, they are "#41.a", "#41.b" in a stable order. The strip uses the same labels. Non-goals: the one-to-one schema change itself (the earlier block), unless HEAD shows it was never done, in which case coordinate (§9).

## 4. Design

The label function counts the live rebuttals of the argument: one gives the bare number, more give number plus letter. Killed or reserved rebuttals keep their letter if they had one only when the argument still has several (§9 Q2).

## 5. Constraints that must still hold

- Argument numbers are never reused or renumbered.
- The link between a rebuttal and its argument (tab switching, expand-together) still works.
- A filed or retired Writing's record is unchanged.

## 6. Options considered, streamline and deburr first, additions last

1. Replace the "lowest target plus letter" rule in html-pages.md and the renderer with "number, plus a letter only when the argument has several". Deletes the lowest-target and "see" logic if the one-to-one change has landed. (recommended)
2. Keep letters everywhere. Rejected by the practitioner.

## 7. Implementation plan

1. Verify against HEAD (§10) and append a verification table to this spec.
2. Change the label rule in the Arguments page renderer and in `shared/html-pages.md`; delete text the new rule makes unnecessary.
3. Tests: an argument with one rebuttal shows "#N"; one with two shows "#N.a", "#N.b"; the strip matches the cards.
4. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of a rebuttal takes its argument's number, with no letter unless the argument has several rebuttals complete!`, then what streamlining and deburring you tried, what you verified and what you assumed without verifying.

## 8. Implementation criteria

1. An argument with exactly one live rebuttal renders it as "#N" on the card and in the strip (test).
2. An argument with several renders "#N.a", "#N.b" ... (test).
3. `shared/html-pages.md` states the rule once and no longer mentions the lowest-numbered target or "see #N.a" if the one-to-one change has landed.

Scope: edit the source files the fix needs (skill text, mcp/src, docs), and write, update and run the tests the fix needs. Streamline and deburr first: solve the problem by removing, merging or simplifying what already exists, and consider an addition only once those ideas are exhausted. Anything added must be shorter than the text it makes unnecessary, and that text is deleted in the same change. Out of scope, because the orchestrating session runs them once after every spec lands: `build_plugin.py` and `check_plugin.py`. Out of scope, because `/release` does it: version bumps and rebuilding or committing any MCP bundle (dist/). Never build a `.plugin` archive.

## 9. Open questions

1. Has the one-to-one change (rebuttal answers exactly one argument) landed at HEAD? If not, does this spec wait for it or include it? Default: include the label change only, and report.
2. Do killed or reserved rebuttals count toward "several"? Default: count live and reserved, not killed.

## 10. Verify against HEAD before building

- Where the Arguments page builds rebuttal labels and the strip.
- The current wording of the Arguments rule in `shared/html-pages.md`, `filing-checklists.md` and `terms-and-symbols.md`.
- Whether `argument_rebuts` is still many-to-many.
