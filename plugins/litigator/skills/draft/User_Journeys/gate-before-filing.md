---
journey: Gate before filing
kind: ux journey — describes the interaction the practitioner experiences, not the data model. Data-focused journeys use a different format and live in `.claude/skills/drafting-data/User_Journeys/`.
actor: practitioner
trigger: the last substance job on a Writing completes and the package exists as files; the Work Board now shows a `Pre-filing consistency gate` job
outcome: every check has passed, is not applicable, or is waived with the practitioner's one-line reason, recorded on the job — and only then is the filing presented as ready for the practitioner's final approval to file
path: happy, with one failure handled
status: aspirational (desired UX — not yet verified against the implementation)
source: L8212 Cowork session, 2026-09-14, Claimant Opening Submissions package (issue #615); ADR 0016
---

# Gate before filing

## The journey

1. **Practitioner:** opens the Writing. The Work Board's ready cards show one job left: *Pre-filing consistency gate*, created when the last substance job completed. They pick it.

2. **Assistant:** claims it, reads back its fixed six steps as the plan, and on approval calls the check tool once on the package folder — the written argument, two signed witness statements, the Index of Exhibits and sixteen exhibit files. One call, no questions.

3. **Assistant:** reports the clean checks in a line each, and the exhibit table once:

   > C1 exhibit numbering: pass — 13 exhibit numbers cited across both witness statements, every one in the Index and on disk; 16 Index rows, 16 files. C6 file sanity: pass — 143 pages across 18 files. C3–C5: not built.
   >
   > | Ex. | Index says | File on disk |
   > |---|---|---|
   > | 1 | Demand letter of January 5, 2024 | Exhibit 1 - Demand Letter for Payment of $150,000 (January 5, 2024).pdf |
   > | … | … | … |

   Whether each file *is* the document its Index row describes is the practitioner's read of that table, not the tool's verdict.

4. **Assistant:** presents the one failed check as its own ceremony, the source presented rather than quoted:

   > **C2 unresolved placeholders: fail (4 findings), all in a signed document.**
   >
   > Para 12 as signed:
   >
   > ```
   > 12. As at [DATE], unbilled work in progress amounts to [___] hours and fees of approximately $[______], exclusive of disbursements and taxes. [WIP figures to be inserted before signing, or delete this paragraph.]
   > ```
   >
   > *(file card: the second signed witness statement, pages 2–3 extracted)* Second witness statement, signed, pp. 2–3, para 12. Yellow: para 12, and the e-signature record on p. 3. Orange: the four unfilled placeholders.
   >
   > Mine: a template paragraph survived into the statement as signed.
   >
   > `[x] current text in full  [x] source file presented, cited page, passage highlighted, legend in caption  [x] context after cited  [n/a] proposed text in full (a gate finding proposes no text)  [x] one plain-text question, no widget`
   >
   > Fix it, or waive it?

5. **Practitioner:** either answer works the same way on the job:
   - *"Fix it."* The assistant outlines nothing itself: the practitioner describes the fix (a corrected statement, re-signed) and it becomes a job in an outlining session. The gate job stays in progress; the next gate session re-runs the tool after the fix lands.
   - *"Waive it: the WIP figures go in by a supplementary statement served with the reply."* The assistant writes that sentence, verbatim, onto the C2 step and stamps it done. It offers no view on whether the waiver is wise.

6. **Assistant:** on a later run where every step is done — passed, not applicable, or waived — completes the job, re-renders, and only now says the filing is ready for the practitioner's final approval to file, listing the waived check and its reason in that same message.

7. **Mirror:** a session asked "is it ready to file?" while a gate step stands open answers with the open step and the finding, never with "yes".

## Principles this journey encodes

- **The gate is a job, not a state.** It claims, locks, records steps and completes like any other job, so the record of what was checked and what was waived survives the session on the Work Board. The seven lifecycle states are untouched (ADR 0016).
- **The gate reports; a job fixes.** No session edits a package document to clear a finding — a placeholder in a signed statement is cured by a corrected statement, not by touching the signed file.
- **Show the mismatch, never describe it.** A failed check is presented per `/show-me`: the offending document itself as a highlighted page extract, captioned with its document and page, and the offending paragraph in full in a code block, before any interpretation.
- **A waiver is the practitioner's sentence, verbatim.** One line, no options, no recommendation, recorded on the step — the same shape as a loose thread (`/drafting-data` §8).
- **Ready to file is refused, not softened, while a step is open.** The refusal names the open step; it does not offer to lower the bar.
- **One decision at a time.** Each failed check is its own ceremony, even when several fail.
