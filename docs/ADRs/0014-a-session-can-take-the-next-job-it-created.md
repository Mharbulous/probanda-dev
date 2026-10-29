---
status: accepted
date: 2026-10-10
---

# A session that finished its job can take the next job it created

Until now a `/draft` session that completed, released or shelved its job took no other (CoClerk ADR 0022 D8, CoClerk ADR 0028 D5). When the practitioner then gave a small follow-up instruction, such as a four-row reorder or a bulk approval, the session had to create the job and hand it to a subagent that opened its own session, re-read the rules and re-rendered, purely to satisfy the rule. Two such hand-offs cost about 99,000 and 187,000 tokens. `drafting_data__assign_job` already allowed the session to take a job it created. Only the prose forbade it. The practitioner reversed the rule on 2026-10-10 (CoClerk ADR 0043, spec `2026-10-09_draft-session-takes-next-created-job-spec.md`). It was ported here on 2026-10-29.

## Decisions

- **D1. The next job it created.** A session that has completed, released or shelved its job may be assigned another, on the practitioner's naming it, only when the session created that job itself in this session. A job that was on the board before, or one another session created, still goes to a new `/draft` session.
- **D2. One job held at a time.** The session holds at most one job at any moment. Each assignment reads a fresh card and runs Branch A afresh.
- **D3. Never dispatched.** Such a session never runs Dispatch. Its "what next?" names by number the Ready jobs it created in this session and says that a new `/draft` session takes any other Ready job. With none, it says only that.
- **D4. Unchanged.** `assign_job`'s `not_created_here` refusal, the take-over form and its explicit yes, the several-jobs mode the practitioner asks for, and the unattended run, which works one job at most.

## Considered options

- **Sequential jobs of any origin.** Rejected: wider than the follow-up instructions that prompted this, and it would reopen CoClerk ADR 0028 D5's loop, where Dispatch takes straight back a job the session just released.
- **Keep the rule and the subagent hand-off.** Rejected by the practitioner: each follow-up cost a fresh session.

## Consequences

- A session may chart jobs and then execute those it charted, one after another.
- The old one-job rule holds for every job the session did not create. A released job is not dispatched straight back, because such a session never dispatches. It retakes a job it created and released only when the practitioner names it.
- The one-job-at-a-time rule is held by the prose and the assignment lock alone. `assign_job` does not check whether the session already holds a job.
- The rule lives in `work/references/dispatch.md` section 14 (Dispatch), `work/references/opening-routes.md`, `draft/references/job-session.md` (Complete), and the rules-map nodes `draft/job` (the session's own job) and `draft/done`.
