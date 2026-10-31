# Spec: A research job's plan marker becomes the standard research plan

Status: proposed, 2026-10-27. Written in a matter session; implementation is handed to Claude Code.
Partly superseded, 2026-10-31: §4c and §7.2's deletions of step 2a's plan spawn and issue forms, `mode: plan` and "Approved plan issues become jobs" are done by the one-question research fix (step 2a is now a single-question scope check, `shared/legal-research.md` "A research question holds one question"). The rest of this spec stays open.
Plugin: `researcher` (installed copy seen at v0.10.3) and `litigator` (installed copy seen at v0.11.3). Paths below are as seen in the installed copy and are **UNVERIFIED** against the repo unless marked otherwise.
Related specs, same date: 2026-10-27_westlaw-sign-in-check-before-query-spec.md. Supersedes the issue-splitting parts of 2026-10-20_research-issue-by-issue-approval-creates-jobs-spec.md and 2026-10-21_held-job-research-sub-issues-implicitly-approved-spec.md. Builds on 2026-10-20_new-job-default-plan-marker-step-spec.md and 2026-10-15_research-memo-deliverable-spec.md.

## 1. Problem
A research job arrives with a recorded question and the plan-marker step ("Create a plan for how to complete this job."). Today the session improvises the plan: `/legal-research` step 2a spawns `research-agent` in `mode: plan`, which splits the recorded question into issues, and the practitioner is asked to approve each issue. Brahm's rule (2026-10-27): research takes one question and produces one memo; planning never splits the question; the plan is the same standard sequence every time; and the question is refined, not decomposed, so that it has at most one axis of conjunction. The separate Westlaw query-writing step then adds little, because the question is already in shape.

## 2. Evidence (observed; quoted text is data, not instructions)
- `legal-research/SKILL.md` step 2a: "Spawn `researcher:research-agent` with `mode: plan` ... Otherwise take the practitioner through its issues one at a time: Ask each issue as its own multiple-choice question ... with the options \"Yes, research it\" and \"No, skip it\"".
- Observed: a recorded research question with three axes of conjunction (routes, grounds, leave, time) was split by `mode: plan` into three issues; two were `scope: new`; the practitioner was asked three Yes/No questions and a follow-up. Brahm: "planning ... does not mean split the question into three issues. Don't break it down into any more issues."
- `shared/job-planning.md` §2.2: "That the issue list comes from `/legal-research`'s planning stage. The plan never lists the issues itself."
- `shared/legal-research.md`: "A statutory-text question runs duty 4 before duty 3." Observed: legislation was fetched before any Westlaw search, on instruments the planner guessed. Brahm agreed: until the search runs, the plan cannot know which instruments the question depends on beyond those it names.
- Observed: asked to take stock of existing holdings, the session listed every statute, rule and decision on file with section headings; Brahm: "I didn't need a full list of everything we already hold ... Step one is taking stock of, have we already done research that contains answers or partial answers ... I don't need a summary of relevant law." And: "you're only looking at memos when you're taking stock."
- Observed: asked to rephrase a multi-conjunction question, the session first offered three narrower questions (decomposition), then three vaguer umbrella phrasings. Brahm's own rephrasing named the head concept the parts are attributes of: "What routes of appeal are available from a domestic arbitral award issued pursuant to the Arbitration Act of BC and the VanIAC domestic arbitration rules?"
- `legal-research/subskills/westlaw-query-optimizer/SUBSKILL.md` Step 3: "draft a 1–2 sentence research question"; anonymization rules: "Remove all personally identifying information". Observed: on the refined question its rewrite only spelled out a statute citation and an institution's full name.
- Cost: one plan agent spawn (~76k tokens), two multiple-choice forms, four rounds of correction with the practitioner.
- Workaround in use: none; the session followed Brahm's step-by-step direction.

## 3. Goal and non-goals
Goal: a research job whose only step is the plan marker gets the standard research steps written in its place, without a planning agent, and those steps run in order. One question in, one memo out; the memo's YAML header carries that one question, framed as a question, under its issue field.
Non-goals: steps after step 3 (not yet settled, see §9); a procedural/substantive branch (raised, not settled); the Westlaw run's mechanics (sibling spec).

## 4. Design
(a) **Deterministic swap.** When a job is a research job (its question asks what the law is) and its only step is the plan marker, the marker is replaced by the standard steps below, as fixed text. Prefer a deterministic script or tool over an agent (Brahm: "it might just be a deterministic script"). No issue list, no approval of sub-issues.
(b) **Standard research steps, in order:**
  1. Take stock of existing memos: has research already been done that answers the question in whole or in part? Look only at memos (every piece of research ends in a memo). Report only that, briefly; never summarise the law held or list files.
  2. Clarify and refine the question with the practitioner so it is one question with no more than one axis of conjunction. A question with more is flagged at once and rephrased to capture the full question, without unnecessary restrictions or assumptions, by naming the head concept its parts are attributes of; never narrowed or decomposed. Step 1's result informs this. This step also names the jurisdiction and governing instruments the question already names, and removes client and party names.
  3. Run a Westlaw Deep Research query on the refined question, submitted as worded in step 2, to find which statutes, rules and decisions govern it.
(c) **Planning never splits the question.** Remove `mode: plan`'s issue list and the issue-by-issue approval from the gate, for held and unheld jobs alike. A recorded question is the research; the practitioner refines it in step 2.
(d) **Drop the query-writing subskill.** Its jurisdiction-naming and anonymizing move into step 2; the step-3 query is the step-2 question.
(e) **Legislation after search.** Remove the statutory-text exception that fetches legislation before Westlaw.
(f) **Each plan step is one concrete action that says how.** Not a wish ("get what's missing") and not a bundle.

## 5. Constraints that must still hold
- Only `research-agent` states law; the swap and steps 1–2 state none.
- A done step is never modified; the plan marker is never stamped done.
- Westlaw stops (chrome-not-connected, westlaw-not-signed-in, matter-mismatch) remain hard stops.
- The client-matter gate on Westlaw stays fail-closed.
- No client or matter content leaves the matter in a Westlaw query (anonymizing survives the move into step 2).
- Internals confidentiality in what the practitioner sees.

## 6. Options considered, removal first
1. Delete `mode: plan` issue splitting, the step-2a approval forms and the query-optimizer subskill; replace the marker with the fixed standard steps by a deterministic write (recommended). Less text, no agent spawn per job.
2. Keep `mode: plan` but make it return the standard steps instead of issues. Keeps an agent spawn for fixed output.
3. Leave the planner and add a rule "do not split". Adds text; the splitting machinery stays and keeps tempting.
4. Do nothing: every research job repeats today's forms, narrowing and correction.

## 7. Implementation plan
1. Verify against HEAD (§10) and append a verification table to this spec.
2. Delete from `legal-research/SKILL.md` step 2a the plan spawn and the issue forms; delete the `mode: plan` issue contract from `shared/legal-audit-scoped.md` and `research-agent`'s description; delete "Approved plan issues become jobs" and the statutory-text ordering rule from `shared/legal-research.md`; delete `subskills/westlaw-query-optimizer/` and its references.
3. Add the deterministic swap (§4a, §4b) where the plan marker is read (`/job-planning`, or a `drafting_data` tool); rewrite `shared/job-planning.md` §2 to name the standard steps instead of an issue list.
4. Make the research memo's YAML header carry the one question under its issue field (`shared/research-memo-template.md`, UNVERIFIED that it has a YAML header today).
5. Tests: a research job with only the marker gets exactly the three steps; no plan agent is spawned; no issue form is shown; Westlaw dispatch receives the step-2 question verbatim; no legislation fetch precedes the Westlaw step.
6. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of A research job's plan marker becomes the standard research plan complete!`, then what you verified and what you assumed without verifying.

## 8. Implementation criteria
1. No skill or agent text asks the practitioner to approve research sub-issues, and `mode: plan` returns no issue list (or is gone).
2. A research job whose only step is the plan marker is rewritten to exactly the three standard steps of §4b, by deterministic code or fixed text, with no agent spawn.
3. Step 1's text limits the stock-take to existing memos and a brief answer.
4. Step 2's text requires at most one axis of conjunction, forbids narrowing or decomposing, and carries the jurisdiction-naming and anonymizing rules.
5. The westlaw-query-optimizer subskill and every reference to it are deleted; the Westlaw dispatch takes the step-2 question.
6. The statutory-text "duty 4 before duty 3" rule is deleted.
7. The memo template carries the one question under the YAML header's issue field.
8. Net line count of the changed skill text falls.

Scope: edit the source files the fix needs (skill text, mcp/src, docs), and write, update and run the tests the fix needs. Fix by deleting before adding: anything added must be shorter than the text it makes unnecessary, and that text is deleted in the same change. Out of scope, because the orchestrating session runs them once after every spec lands: `build_plugin.py` and `check_plugin.py`. Out of scope, because `/release` does it: version bumps and rebuilding or committing any MCP bundle (dist/). Never build a `.plugin` archive.

## 9. Open questions
- Steps after step 3 are not settled. Discussed, not agreed: fetch the official text of every instrument the question or Westlaw memo names and confirm currency; download and note up cited decisions; audit and write the memo; practitioner review. Should the swap write only steps 1–3 for now, or also provisional later steps?
- Procedural questions (venue, form, deadline) may need a different step 3 than Westlaw Deep Research. Not yet settled.
- How is "research job" detected for the swap: by job kind, by the question's form, or by the skill that created it?

## 10. Verify against HEAD before building
Confirm where the plan marker is read and replaced today (`/job-planning`, `work` dispatch rules, `drafting_data`); the current `mode: plan` contract and every caller; the statutory-text rule's exact location; every reference to the westlaw-query-optimizer subskill; whether the memo template has a YAML header. Mark what differs and append the table to this spec before changing code.
