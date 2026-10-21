# Spec: a held research job's sub-issues are implicitly approved, and an open source tier blocks its memo

Status: implemented, 2026-10-21. Owner of the held-job branch of `/legal-research` step 2a. The no-job branch stays with 2026-10-20_research-issue-by-issue-approval-creates-jobs-spec.md.

## 1. Problem

A `/draft` session holding a one-question research job ran `/legal-research` step 2a. The step put four sub-issues of that same question to the practitioner as "Yes, research it / No, skip it". The practitioner declined them as a repeat of planning already done, and the session treated sub-issues the answer depended on as dropped. The memo closed with "More research is needed on the following issues" for rule Parts 10-20, Part 25, the appendices and the practice directions, and the job was completed with that gap open. Approving a research job approves every sub-issue its question needs, so asking about them makes necessary work look optional.

## 2. Causes (confirmed at d94918d)

1. Step 2a's Yes/No form ran for every plan. Its only held-job skip covered a job whose title was an issue approved in the same session.
2. The `mode: plan` completion test let an issue be "named as a gap with its research offer" before any tier had run, and the plan did not mark which issues lay inside the question.
3. A Mixed-coverage return recorded no tiers left unrun, and the gate re-invoked the agent only once before saving.
4. `shared/job-planning.md` §2 required the practitioner to approve every research job's issue list.
5. `/draft`'s Complete rule did not stop a job with an open in-scope gap.

## 3. Decision (option 1)

- In a held job, step 2a runs the plan and asks nothing. Its `scope: in` issues are the job's internal checklist. A `scope: new` issue is captured as a loose thread and offered, and it is researched only on the practitioner's word. The practitioner may still narrow or waive scope in their own words.
- The opinion audit writes `gap: <issue> : tiers not run: <tier>[; <tier>] / none` for each issue it leaves open, and returns the lines.
- On a held job, the gate runs each named tier and re-invokes the agent before saving, at most once per tier per issue.
- `/draft` does not complete a research job whose last return names a tier not run, unless the practitioner waives it in their own words.

## 4. Where

`legal-research/SKILL.md` step 2a; `shared/legal-research.md` ("Approved plan issues become jobs", "On a held job, an open tier is not an answer"); `shared/legal-audit-scoped.md` (`mode: plan`); `shared/legal-audit-protocol.md` (Step 4 Mixed coverage, Step 6); `shared/job-planning.md` §2; `draft/references/job-session.md` (Complete). Tests: `legal-research/tests/test_plan_issue_approval.py`, `legal-research/tests/test_held_job_gaps.py`, `draft/tests/test_research_job_gaps.py`.
