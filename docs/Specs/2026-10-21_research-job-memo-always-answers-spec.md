# Spec: a research job's memo always answers, and its unrun tiers become steps on the job

Status: implemented, 2026-10-21. Follows 2026-10-21_held-job-research-sub-issues-implicitly-approved-spec.md, which stays the owner of step 2a and of the open-tier loop.

## 1. Problem

On a `/draft` research job, research-agent returned a memo whose Conclusion opened "More research is needed on the following issues", whose gaps named Westlaw (awaiting approval), the pool NOT AUDITED and CanLII with no key, and which ended on six research offers. The caller relayed them and stamped two plan steps done before those tiers had run. "More research is needed" is never an answer to a research job.

## 2. Causes (confirmed at 022363b)

1. Protocol Step 6 opened a Mixed-coverage Conclusion with Step 4's mandated sentence, on a job too. Step 4's closed gate wrote no memo and no `gap:` lines.
2. The `gap:` line named only the Westlaw, Legislation and `6. LAW` tiers, so the pool and the citator surfaced as offers.
3. Step 5 wrote offers for work on the job question itself.
4. Gate step 5 and "When the gate closes, closed is the answer" told every caller to relay and stop. The open-tier loop recorded nothing on the job and did not say when a step is stamped.
5. `shared/job-planning.md` §2 gave the Westlaw query an approval point, against the gate's "without asking unless the practitioner declined". Brahm ruled 2026-10-21 that the gate's rule holds.

## 3. Decision (option 1)

- On a job, the audit has no closed gate and no mandated sentence. Each Conclusion answers from the sources held, or says `No authority located in <the tiers searched>.` Gaps stay in the `Confidence:` header and the `gap:` lines, which now also name `Commons: NOT AUDITED: <state>` and `CanLII: <citation> NOT NOTED UP`. The job question gets no offers.
- The caller adds one step per named tier to the held job by the partial replace's `INSERT` with no `DELETE`. A tier only the practitioner can open, such as a key, is a step in their name. A step is stamped only once its work has run.
- The Westlaw hard stop and the fetcher and refusal stops are unchanged.

## 4. Where

`shared/legal-audit-protocol.md` Steps 4 to 6; `shared/research-memo-template.md` ("A job's memo"); `shared/legal-research.md` ("When the gate closes", "After the answer", "On a held job, an open tier is not an answer"); `legal-research/SKILL.md` step 5; `shared/job-planning.md` §2; `drafting-data/references/jobs-run.md` §5 (the partial replace). Test: `legal-research/tests/test_job_memo_answers.py`.
