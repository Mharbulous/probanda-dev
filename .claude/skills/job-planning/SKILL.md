---
name: job-planning
description: >
  Check a named job's plan against the minimum every job plan must hold (each step a concrete
  action, the deliverable and where it lands, the approval points, the completion test, and a
  research job's sources) and upgrade a plan that falls short, never altering a step already
  done. Use for "plan job N" or "check job N's plan". Working the job -> /draft.
---

**Internals stay confidential** (`shared/internals-confidentiality.md`): nothing the practitioner sees names a Probanda tool, table, field, internal type or code, or explains how Probanda works inside. It hides mechanism, never an outcome or an error.

# Job planning

A thin front end. The rules are `shared/job-planning.md`'s: read it first and follow it. Nothing here restates them.

1. **Name the job.** Take the job number the practitioner gave. With none, ask for it, and propose none.
2. **Enter and read.** Enter the matter as `/draft` enters (`.claude/skills/draft/SKILL.md` §6), then read the job's card, `drafting_forms__board_card` with `jobs: [N]`: its title, intent, steps and which are done.
3. **Compare.** Compare the steps not yet done with `shared/job-planning.md` sections 1 and 2, after the restating check (`draft/references/job-session.md`, "A step that only restates the request"). A plan that meets them: say so in one line and stop. A job the shared file's section 3 skips: say which kind it is and stop. A job whose only step is the plan marker (`shared/job-planning.md` section 3, "The plan marker") never meets them: go to step 4.
4. **Upgrade.** A plan that falls short is upgraded by `shared/job-planning.md` section 3: the session writes the steps not yet done, with no adoption. On a ready job with no step done and no plan approved, the write is `/drafting-data` §5's pickup rewrite. On a job this session holds, it is §5's partial replace. Either write replaces the plan marker with the planned steps and leaves every done step as it is. Any other job is never written here: show the upgraded plan, say it applies when the job is next picked up or taken over, and stop.

It assigns no job, dispatches no work, states no law and touches no date (`shared/deadline-isolation.md`). Every write goes through `/drafting-data`.
