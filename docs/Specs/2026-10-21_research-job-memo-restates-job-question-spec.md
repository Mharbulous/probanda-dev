# Spec: a research job's memo answers the job's own question, verbatim

Status: implemented, 2026-10-21. Builds on 2026-10-21_held-job-research-sub-issues-implicitly-approved-spec.md, which owns plan approval and open tiers on a held job.

## 1. Problem

A `/draft` session worked a research job whose title was two linked questions. `research-agent` in `mode: plan` divided the title into three issues of its own wording, and the saved memo used them as its headings, plus a section on a point the title never asked. None was the title restated. The practitioner wants one Issue holding the job's question, with the title's own parts as numbered sub-issues in the title's exact words.

## 2. Causes (confirmed at f86b1cb)

1. `shared/research-memo-template.md` headed each issue `## Issue <n>: <the issue in a few words>`, so the agent paraphrased.
2. The spawn template in `shared/legal-research.md` had no field carrying the held job's title.
3. `shared/legal-audit-scoped.md` `mode: plan` let the planner divide a job's question into issues of its own.
4. `/draft`'s Complete rule never compared the memo with the job's title.

## 3. Decision (options 1, 2 and 3)

- The spawn prompt carries `Job question:`, the held job's title verbatim, or `none`.
- With a job question, plan mode splits it only at its own question marks, each part verbatim, and adds no issue. What a part needs checked goes in its sources line. A point outside the question is `scope: new`.
- The memo has one `## Issue` holding the job question verbatim, and a `### Sub-issue <n>` per part, verbatim, when there is more than one. No other issue or topic heading: a finding beyond the question is a Step 5 offer in the notes.
- `/draft` compares the memo's headings with the job's title before completing a research job, and has the agent rewrite a memo that differs, unless the practitioner says to complete it as is.
- Split at question marks only, never at "or", so a multiple-choice question stays one part. No "framed for the document" wording, because rewording the title is what this forbids.

## 4. Where

`shared/legal-research.md` (spawn template); `legal-research/SKILL.md` step 2a; `shared/legal-audit-scoped.md` (`mode: plan`); `shared/research-memo-template.md` ("A job's memo"); `shared/job-planning.md` §2; `draft/references/job-session.md` (Complete). Tests: `legal-research/tests/test_job_question_memo.py`, `draft/tests/test_research_job_gaps.py`.
