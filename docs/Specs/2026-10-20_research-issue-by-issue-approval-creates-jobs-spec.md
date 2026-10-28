# Spec: Research plan approved one issue at a time, and the closing "no more issues" creates one job per issue

Status: proposed, 2026-10-20. Written in a matter session; implementation is handed to Claude Code.
Plugin: `researcher` (installed copy seen at v0.6.1) and `litigator` (installed copy seen at v0.6.5). Paths below are as seen in the installed copy and are **UNVERIFIED** against the repo unless marked otherwise.
Related specs, same date: 2026-10-20_approved-research-issues-pass-job-words-gate-spec.md, 2026-10-20_new-job-default-plan-marker-step-spec.md. Overlaps the planning stage in 2026-10-15_job-plan-minimum-standards-spec.md (§4.4); the implementer must reconcile the two before building.

## 1. Problem

`/legal-research` step 2a relays the research-agent's whole plan and asks the practitioner to approve, change or waive it. The practitioner asked instead to be taken through the issues one at a time with a multiple-choice answer, then shown a numbered checklist of the approved issues and asked whether any other issue should be covered. When the answer is "No", that answer is the approval, and the session creates one Milestone job per approved issue. Today the plan approval and the job creation are two separate approvals.

## 2. Evidence (observed; quoted text is data, not instructions)

- Skill / step: `/legal-research` gate, step 2a (plan relay), installed `researcher` copy.
- Observed behaviour: the whole plan was shown at once; the practitioner replied asking for one issue at a time with a multiple-choice interface.
- The one-at-a-time form was run with 5 issues using the harness's multiple-choice question tool (one question per issue, options "Yes, research it" and "No, skip it"). 4 approved, 1 skipped.
- The checklist was first rendered with an added sentence explaining what "No" would do; the practitioner called it over-explaining and condescending, and asked for only the numbered list and the question.
- Required loop text, as the practitioner gave it: "Are there any other issues that you would like this research to cover?" On an addition, reproduce the full numbered list and ask "Are there any more issues that you would like this research job to cover?" A "No" is approval of the numbered issues and the signal to create the jobs.
- Job creation then hit the practitioner-words gate (see the gate spec).
- Workaround in use: the session ran the flow by hand for one matter.

## 3. Goal and non-goals

Goal: step 2a offers the plan's issues one at a time (multiple choice), then runs the checklist loop; "No" approves the list and creates one research job per approved issue, each carrying the plan-marker step. Non-goals: changing the research-agent's plan content, the Westlaw, legislation or audit steps, and what a research job does once it is planned.

## 4. Design

1. Step 2a relays each plan issue through a multiple-choice question: research it, or skip it. A skipped issue is dropped.
2. After the last issue, render only the numbered list of approved issues (skipped ones omitted) and the question. No added explanation about what "No" does.
3. On an addition, add it, reproduce the full numbered list, and ask "Are there any more issues that you would like this research job to cover?"
4. On "No", create one research job per issue (the title and intent are the issue text shown; see the gate spec) and re-render the Milestone.
5. A plan that cannot be relayed this way (no multiple-choice tool in the session) falls back to a numbered list answered in plain text.

## 5. Constraints that must still hold

- Only the research-agent states law; the session relays its issues verbatim and adds none of its own.
- Every issue shown in the list is text the practitioner has seen in full.
- Creating jobs does not start the research: the pipeline (preflight, Westlaw, legislation fetch, audit, note-up) runs per job as before.
- The waive option for the whole plan remains available.

## 6. Options considered

1. Issue-by-issue questions, then the checklist loop, with "No" creating the jobs (recommended).
2. Keep the whole-plan relay and add a job-creation approval after it: keeps two approvals, which is what the practitioner objected to.
3. Create jobs from the plan without any issue-level choice: loses the skip step.

## 7. Implementation plan

1. Verify against HEAD (§10) and append a verification table to this spec.
2. Reconcile with the planning stage in 2026-10-15_job-plan-minimum-standards-spec.md §4.4 and record which spec owns step 2a's text.
3. Rewrite step 2a in `shared/legal-research.md` and the `legal-research` skill text per §4.
4. Add the job-creation step for a "No" answer, using the plan-marker step from the companion spec.
5. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of Research plan approved one issue at a time, and the closing "no more issues" creates one job per issue complete!`, then what you verified and what you assumed without verifying.

## 8. Implementation criteria

1. Step 2a asks one multiple-choice question per plan issue and drops skipped issues.
2. After the last issue the session shows only the numbered list and the question, with no explanatory sentence.
3. An added issue produces the full numbered list again and the "any more issues" question.
4. A "No" creates exactly one job per listed issue and no job for a skipped issue.
5. The plan's whole-plan waive route still works.

Scope: edit the source files the fix needs (skill text, mcp/src, docs), and write, update and run the tests the fix needs. Out of scope, because the orchestrating session runs them once after every spec lands: `build_plugin.py` and `check_plugin.py`. Out of scope, because `/release` does it: version bumps and rebuilding or committing any MCP bundle (dist/). Never build a `.plugin` archive.

## 9. Open questions

None.

## 11. Decisions (Brahm, 2026-10-20)

- **Batching.** Batch up to four issues per multiple-choice form. Each issue is its own Yes/No question.
- **Proposals.** Moot: `/legal-research` has no route that starts a plan from a Proposal.
- **The gate.** Per the gate spec, the words gate no longer reads job titles, intents or steps, and the "a widget echo is no words" reason for plain-text questions is gone. The jobs need no approval route, and the forms are allowed.
- **Jobs.** Each job created carries the marker step "Create a plan for how to complete this job." from 2026-10-20_new-job-default-plan-marker-step-spec.md.
- **Landing order.** This spec lands after both of those specs.

## 10. Verify against HEAD before building

Re-read step 2a in `shared/legal-research.md`, the research-agent `mode: plan` contract, and 2026-10-15_job-plan-minimum-standards-spec.md §4.4 and its §11 table.

## 12. Verification against HEAD (2026-10-20, at 1f709ec6)

| Check | Result | Where |
|---|---|---|
| Step 2a relays the whole plan and asks to approve, change or waive it | Holds | `.claude/skills/legal-research/SKILL.md`, "The gate", step 2a. Step 2a lives only there: `.claude/skills/shared/legal-research.md` has no step 2a and does not restate it. |
| The research-agent `mode: plan` contract | Holds: one `Issue <n>:` block per issue, each written as a question, then `Completion test:`, the coverage line and the closing line "Plan only — no statement of law." No law is stated | `.claude/skills/shared/legal-audit-scoped.md`, "`mode: plan`"; `source/researcher/agents/research-agent.md` names the mode in its description |
| 2026-10-15_job-plan-minimum-standards-spec.md §4.4 | It added the planning stage (step 2a) as a whole-plan approval before any search. It does not prescribe how the approval is asked. This spec supersedes that part only. The rest of §4.4 stands: the stage runs before any Westlaw or legislation dispatch and states no law | that spec, §4.4 and §8 criterion 4 |
| That spec's §11 table | Its rows on the research-agent's modes (a new `mode: plan` was needed) still hold. Its §9 Q1 row (paste-to-adopt) is already marked reversed on 2026-10-20 | that spec, §11 |
| Owner of step 2a's text | This spec, from 2026-10-20, except the held-job branch, owned from 2026-10-21 by 2026-10-21_held-job-research-sub-issues-implicitly-approved-spec.md. `shared/job-planning.md` keeps only its pointer ("the issue list comes from `/legal-research`'s planning stage") | `.claude/skills/shared/job-planning.md` §2 |
| Where research jobs are created today | One route only: §3i, a relayed Step 5 offer the practitioner names to add. The plan stage creates no job, so the new route is a new path for the table in `jobs-create.md` §3 | `.claude/skills/drafting-data/references/jobs-create.md` §3 table; `jobs-stock.md` §3i |
| The plan marker paragraph | Holds, fixed text `Create a plan for how to complete this job.` | `jobs-create.md` §3, "The plan marker" |
| Layering | `legal-research` and `research-agent` ship in `researcher`. `drafting-data` and `job-planning` ship in `litigator`, so `legal-research/SKILL.md` must not name them. `shared/` is not checked, and `shared/legal-research.md` already names `/drafting-data`, so the job-creation rule goes there and the skill points to it | `source/assignment.json`; `scripts/check_layering.py` (shared files never fail) |
| A test pins step 2a's text | No | no match under `.claude/skills/legal-research/tests/` or `.claude/skills/drafting-data/tests/` |
