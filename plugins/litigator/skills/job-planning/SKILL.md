---
name: job-planning
description: >
  Check a named job's plan against the minimum every job plan must hold (each step a concrete
  action, the deliverable and where it lands, the approval points, the completion test, and a
  research job's sources) and upgrade a plan that falls short, never altering a step already
  done. Use for "plan job N" or "check job N's plan". Working the job -> /draft.
---

<!-- litigator v0.24.1 -->
> **Installed copy.** This skill's full source tree ships beside this file, and a relative path in the text below cites that tree. Resolve one by trying, in order: the directory of the file you are reading, then `${CLAUDE_SKILL_DIR}/<path>`, then `${CLAUDE_SKILL_DIR}/../<path>` (so `shared/x.md` is at `${CLAUDE_SKILL_DIR}/../shared/x.md`). `${CLAUDE_SKILL_DIR}` is the directory holding this SKILL.md, even where it shows unsubstituted: never search for it or guess. Read references and shared files from there with the Read tool, a whole file or an offset and limit, never with a shell command, the litigation data server's skill-source tool or a folder-access request; scripts and templates the text declares are executed and read from there too. Before each fresh read (a file not already in context), list only `${CLAUDE_SKILL_DIR}/../../..` (the folder holding this plugin's folder). If it holds this plugin's folder name, with any `~g<N>` suffix removed, plus a `~g<N>` higher than this plugin's folder's own (none counts as 0), or if `${CLAUDE_SKILL_DIR}` no longer exists, the plugin was re-synced mid-session: take the highest `~g<N>` copy and repeat the same three tries with its `skills/<this skill>` directory in place of `${CLAUDE_SKILL_DIR}`; tell the user once that the plugin updated mid-session, from the version in this file's version comment to the version in that folder's copy of this SKILL.md. If a file the text names is missing at every one of those paths, including the re-synced folder's, STOP and report the exact path and error to the user rather than substituting an alternative: do not re-derive a script's logic from its source text or the prose, and do not search elsewhere on the filesystem. Ask the user to reinstall the plugin and fully restart the app; this may fix it, but STOP means stop regardless: do not diagnose further yourself.
> **HTML pages.** Every HTML file this plugin writes is a human interface generated from its databases; an agent never views, reads, greps, parses, scripts over, authors or requests a screenshot of one, but may present one to a human user to view, staging it first where presenting needs that, and may view a screenshot the user provides on their own initiative. The rule and the data to use instead: `shared/html-pages.md`.

**Internals stay confidential** (`shared/internals-confidentiality.md`): nothing the practitioner sees names a Probanda tool, table, field, internal type or code, or explains how Probanda works inside. It hides mechanism, never an outcome or an error.

# Job planning

A thin front end. The rules are `shared/job-planning.md`'s: read it first and follow it. Nothing here restates them.

1. **Name the job.** Take the job number the practitioner gave. With none, ask for it, and propose none.
2. **Enter and read.** Enter the matter as `/draft` enters (`work/references/procedure.md` §6), then read the job's card, `drafting_forms__board_card` with `jobs: [N]`: its title, intent, steps and which are done.
3. **Compare.** Compare the steps not yet done with `shared/job-planning.md` sections 1 and 2, after the restating check (`work/references/job-session.md`, "A step that only restates the request"). A plan that meets them: say so in one line and stop. A job the shared file's section 3 skips: say which kind it is and stop. A job whose only step is the plan marker (`shared/job-planning.md` section 3, "The plan marker") never meets them: go to step 4.
4. **Upgrade.** A plan that falls short is upgraded by `shared/job-planning.md` section 3: the session writes the steps not yet done, with no adoption. On a ready job with no step done and no plan approved, the write is `drafting-data/references/jobs-run.md` §5's pickup rewrite. On a job this session holds, it is §5's partial replace. Either write replaces the plan marker with the planned steps and leaves every done step as it is. Any other job is never written here: show the upgraded plan, say it applies when the job is next picked up or taken over, and stop.

It assigns no job, dispatches no work, states no law and touches no date (`shared/deadline-isolation.md`). Every write goes through `/drafting-data`.
