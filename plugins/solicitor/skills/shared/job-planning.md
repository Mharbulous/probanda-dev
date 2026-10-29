# Job planning

Shared rule for what a job's plan must hold. It is not a skill: it has no `SKILL.md` and is never wrapped. `/draft` and `/prepare` read it wherever a plan is written, proposed, picked up, taken over, restored or announced, and `/job-planning` applies it to a named job. A job's plan is its step list: no other field holds it, so everything below is stated in the steps' own words.

## 1. Minimum contents

Every plan states:

1. **Each step as a concrete action on a named object.** A step never restates the job's title or intent: that is the restating check (`work/references/job-session.md`, "A step that only restates the request"), which stays and runs first.
2. **The deliverable and where it lands:** the document, record or answer the job produces, and the folder, Writing or record it is saved to.
3. **Each approval point:** every point where the practitioner must approve before the work continues, named at the step it follows.
4. **The completion test:** what must be true for the job to be complete.

No step computes or mentions a deadline (`shared/deadline-isolation.md`). No step states law: an issue, an instrument or a doctrine is named only as the practitioner, the record or `/legal-research`'s planning stage put it.

## 2. A research job

A job whose work is a question about what the law is also states:

1. **The sources to check, in order:** the matter's `6. LAW` folder and case data, then the shared pool, then the Westlaw query, run without asking unless the practitioner declined it, then the legislation fetch, then the audit and note-up (`shared/research-priority.md`).
2. **That the issue list comes from `/legal-research`'s planning stage.** The plan never lists the issues itself. A job whose research question is recorded needs no approval of its issues: approving the job approved its question, its one `scope: in` issue (`/legal-research` step 2a). Only an issue outside the recorded question needs the practitioner's word. The planner adds no issue to it: its one issue is the recorded question, verbatim, and a question holding more than one is proposed for splitting into one job per question (`shared/legal-research.md`, "A job holds one question").
3. **The memo deliverable:** the answer saved in the matter's `6. LAW` folder by `/legal-research`'s "After the answer" rule, and the memo's one Issue is the job's title, verbatim (`shared/research-memo-template.md`, "A job's memo").
4. **The completion test:** the memo's Conclusion answers the Issue with pinpoint citations, and research the scope test requires (`shared/legal-audit-protocol.md` Step 4) is left as a gap only once every source tier has run on it and memo-reviewer's loop has ended. Until then, each tier memo-reviewer finds required is a step on the job, stamped done only once its work has run (`shared/legal-research.md`, "On a held job, an open tier is not an answer"). While a missing credential or an unreachable source blocks that tier, its step is set ↻ (`drafting_data__set_step`, `/drafting-data` `references/jobs-run.md` §6b), never stamped done.

## 3. Upgrading a plan that falls short

At pickup, take-over, restore and a re-taken release, and before each announcement of the plan, compare the steps not yet done with sections 1 and 2. Where they fall short, rewrite only the steps not yet done so that the plan meets them. A step already done is frozen: its words, its place and its stamp are never changed, removed or re-stamped. A status on a step not yet done (↻, ☒, ⏸ or ⏳, `/drafting-data` `references/jobs-run.md` §6b) is not a stamp: that step is still not done, and only a step stamped done is frozen. The write is `/drafting-data` §5's: the pickup rewrite on a ready job with no step done, and the partial replace on a job this session holds, never the whole-list replace, which would discard the stamps. An upgrade adds structure drawn from the job's recorded words and the record, never substance: no position, figure, statement of law or research question beyond what the record holds.

**The plan marker.** A job whose only step is `Create a plan for how to complete this job.` (`/drafting-data` §3, "The plan marker") has no plan: it always falls short of sections 1 and 2, and its upgrade replaces the marker step with the planned steps. The marker is never stamped done, so it carries no `done_at` and the upgrade removes it like any step not yet done. Steps already done are never altered.

An upgrade needs no adoption and no pasting (`shared/paralegal-posture.md` section 3): the session writes the upgraded steps and names them in the announcement, as the pickup review names what it changed.

The upgrade skips a job whose steps are fixed or kept as written: a fixed-text job (the list `work/references/job-session.md`'s pickup review skips), an intake note-up or grouped intake job, and a job whose steps were split along its item's own numbered or lettered parts (`draft/references/job-session.md`, `draft.note-up`).

**Unattended.** An unattended run never pauses and never upgrades. Where it meets a plan that falls short, it writes nothing, reports which of sections 1 and 2 the plan lacks, and stops, as the restating check does.
