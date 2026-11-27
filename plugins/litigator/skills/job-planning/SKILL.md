---
name: job-planning
description: >
  Check a named job's plan against the minimum every job plan must hold (each step a concrete
  action, the deliverable and where it lands, the approval points, the completion test, and a
  research job's sources) and upgrade a plan that falls short, never altering a step already
  done. Use for "plan job N" or "check job N's plan". Working the job -> /draft.
---

<!-- litigator v0.30.3 -->
> **Installed copy.** Relative paths below cite this skill's shipped tree.
> Resolve in order: current file's dir, `${CLAUDE_SKILL_DIR}/<path>`, then `${CLAUDE_SKILL_DIR}/../<path>` (so `shared/x.md` is `${CLAUDE_SKILL_DIR}/../shared/x.md`).
> `${CLAUDE_SKILL_DIR}` is this SKILL.md's directory even if unsubstituted: never search or guess.
> Read references and shared files with Read (whole or offset/limit), never via shell, the litigation data server's skill-source tool, or a folder-access request; run declared scripts and templates from there too.
> Before each fresh read (not already in context), list only `${CLAUDE_SKILL_DIR}/../../..`. If it holds this plugin's folder name (sans `~g<N>`)
> plus a `~g<N>` higher than this plugin's folder's own (none counts as 0), or if `${CLAUDE_SKILL_DIR}` no longer exists, the plugin was re-synced mid-session:
> retry the three paths with the highest `~g<N>` copy's `skills/<this skill>` dir and tell the user once that the plugin updated mid-session (old version comment to new SKILL.md comment).
> If still missing at every path, STOP and report the exact path and error: do not substitute, re-derive script logic, search elsewhere, or diagnose further; ask the user to reinstall the plugin and fully restart the app.

**Internals stay confidential** (`shared/internals-confidentiality.md`): nothing the practitioner sees names a Probanda tool, table, field, internal type or code, or explains how Probanda works inside. It hides mechanism, never an outcome or an error.

# Job planning

A thin front end. The rules are `shared/job-planning.md`'s: read it first and follow it. Nothing here restates them.

1. **Name the job.** Take the job number the practitioner gave. With none, ask for it, and propose none.
2. **Enter and read.** Enter the matter as `/draft` enters (`work/references/procedure.md` §6), then read the job's card, `drafting_forms__board_card` with `jobs: [N]`: its title, intent, steps and which are done.
3. **Compare.** Compare the steps not yet done with `shared/job-planning.md` sections 1 and 2, after the restating check (`work/references/job-session.md`, "A step that only restates the request"). A plan that meets them: say so in one line and stop. A job the shared file's section 3 skips: say which kind it is and stop. A job whose only step is the plan marker (`shared/job-planning.md` section 3, "The plan marker") never meets them: go to step 4.
4. **Upgrade.** A plan that falls short is upgraded by `shared/job-planning.md` section 3: the session writes the steps not yet done, with no adoption. On a ready job with no step done and no plan approved, the write is `drafting-data/references/jobs-run.md` §5's pickup rewrite. On a job this session holds, it is §5's partial replace. Either write replaces the plan marker with the planned steps and leaves every done step as it is. Any other job is never written here: show the upgraded plan, say it applies when the job is next picked up or taken over, and stop.

It assigns no job, dispatches no work, states no law and touches no date (`shared/deadline-isolation.md`). Every write goes through `/drafting-data`.
