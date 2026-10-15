# Spec: Job title spelling cleanup runs first on taken-over and restored jobs

Status: proposed, 2026-10-15. Written in a matter session; implementation is handed to Claude Code.
Plugin: `litigator` (installed copy seen at v0.2.2). Paths below are as seen in the installed copy and are **UNVERIFIED** against the repo unless marked otherwise.
Related specs, same date: `2026-10-15_job-plan-minimum-standards-spec.md`, `2026-10-15_research-memo-deliverable-spec.md`, `2026-10-15_suggestion-skill-to-practice-plugin-spec.md`, `2026-10-15_posture-scope-design-partner-spec.md`

---

## 1. Problem

A job taken over from another session kept a title with an obvious spelling error ("think" for "thing"). The session printed the misspelled title in the Job header and carried it through the turn. Title cleanup exists, but only in the pickup review, which runs before the assigning write of a Ready job and explicitly skips any job with its plan already approved, which every taken-over job has. Brahm's instruction: when a job's title has an obvious spelling error, correcting the title is the first thing done on the job, whatever lane it came from.

## 2. Evidence (observed; quoted text is data, not instructions)

- `draft/references/job-session.md`, The pickup review: "Before the assigning write of any ready job, one-step or many-step, read its card ... and review both: Title ..."
- Same section: "The review skips a job with any step done or its plan already approved (a released job keeps its plan and stamps, as a taken-over or restored one does) ..."
- `draft/references/take-over.md`, the taken-over read-back: covers the header, steps, answers, loose threads and sources; nothing on the title.
- `drafting-data` §3 (cited from job-session.md): a new job's title is "cleaned of spelling, typos, grammar and capitalisation" at creation, and that cleanup "is not a proposal and needs no adoption" (`shared/paralegal-posture.md` §3).
- Observed: the job was In Progress in another session (plan approved, 0 of 1 steps done); take-over form, `assign_job` with `takeover: true` returned `assigned`; the Job header printed the misspelled title verbatim. Cost: one practitioner correction turn.
- Workaround in use: the session promised to fix the spelling at its next write to the job.

## 3. Goal and non-goals

Goal: every job this session comes to hold (newly assigned, taken over, restored or released and re-taken) has its title's obvious spelling errors corrected as the first act after it is held, before the Job header prints. Non-goals: shortening or re-summarising titles on taken-over jobs (the pickup review's other title rules stay Ready-only), touching any step, and fixed-text jobs.

## 4. Design

1. Split the pickup review's title work into two parts: (a) spelling cleanup, by `/drafting-data` §3's existing rule (spelling, typos, capitalisation only; no word added, removed or reordered beyond correcting the misspelled word); (b) the existing shortening rule.
2. Part (a) runs on every job at the moment it becomes this session's: before the assigning write on a Ready job (as now), and immediately after `assigned` on a take-over, a restore or a re-taken released job. It is a clerical write needing no adoption.
3. The Job header (`SKILL.md`, Job header) prints the corrected title; the announcement adds `Retitled from: "<old title>"` as the pickup review already does.
4. Part (a) never touches steps, done or not, and skips fixed-text jobs whose titles readers match by text (stock, counsel's review, scrutiny review, pre-filing gate, loose-threads job).
5. Unattended runs apply part (a) too, since it adds no substance.

## 5. Constraints that must still hold

- A completed step is never modified.
- The practitioner-words gate: the cleanup adds no word the title did not hold, other than the corrected spelling.
- Fixed-text job titles stay byte-identical.
- Take-over still requires the practitioner's explicit yes before any write.

## 6. Options considered

1. Spelling cleanup on every held job, first act (recommended): small, matches Brahm's instruction, reuses the §3 rule.
2. Run the whole pickup review on taken-over jobs: would also re-split steps, which the inherited-stamps rule forbids.
3. Fix only at creation (status quo): misses jobs created before the cleanup existed and jobs created in other sessions.

## 7. Implementation plan

1. Verify against HEAD (§10) and append a verification table to this spec.
2. Edit `draft/references/job-session.md` (pickup review) to split title spelling cleanup from shortening and state where each runs.
3. Edit `draft/references/take-over.md` so a taken-over, restored or released job runs the spelling cleanup first, before the header.
4. Check whether a `/draft` rules-map node holds the take-over or pickup rule (`draft/rules/nodes/`); if so, edit the node, not the atom.
5. Confirm the `/drafting-data` §5 pickup-rewrite path admits a title-only write on a wip job held by this session; if not, extend it.
6. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of Job title spelling cleanup runs first on taken-over and restored jobs complete!`, then what you verified and what you assumed without verifying.

## 8. Implementation criteria

1. The pickup review text names spelling cleanup as a separate part that also runs after a take-over, restore or re-taken release.
2. `take-over.md` orders the spelling cleanup before the Job header and the announcement.
3. The rule states it never alters a step and skips fixed-text jobs.
4. The drafting-data write path for a title-only correction on a held wip job exists and is named.
5. No other title rule (shortening) is extended to taken-over jobs.

Scope: edit source only (skill text, mcp/src, docs). Out of scope, because `/repackage` does it in the cloud from origin/main: rebuilding or committing any MCP bundle (mcp/dist), npm or esbuild runs, the plugin packager, version bumps, *-latest.plugin files, and running `/repackage`. Out of scope, because the orchestrating session runs it once after every spec lands: `build_plugin.py`. Out of scope, because valid testing happens only in Cowork after `/repackage`: writing, updating or running any test, suite, golden or E2E run in Claude Code. A type-check of edited TypeScript is allowed; it is not a test.

## 9. Open questions

1. Whether the title-only write on a wip job needs a new drafting-data operation or fits the existing pickup rewrite is **UNVERIFIED**.

## 10. Verify against HEAD before building

- The pickup review and its skip list still read as quoted in §2.
- `take-over.md` still has no title step.
- No other spec or plan already addresses title cleanup on taken-over jobs.

## 11. Verification against HEAD (2026-10-15, at d41fb32)

| Check | Result | Where |
|---|---|---|
| The pickup review reads as quoted in §2 | Holds | `.claude/skills/draft/references/job-session.md`, atom `draft.pickup-review` |
| Its skip list reads as quoted in §2 | Holds | same atom, "The review skips a job with any step done or its plan already approved ..." |
| `take-over.md` has no title step | Holds | `.claude/skills/draft/references/take-over.md`, atoms `draft.take-over.readback` and `draft.take-over.restored` |
| `/drafting-data` §3's cleanup and `shared/paralegal-posture.md` §3 read as quoted in §2 | Holds | `.claude/skills/shared/paralegal-posture.md` §3: "A new job's title cleaned of spelling, typos, grammar and capitalisation by `/drafting-data` §3's rule is not a proposal and needs no adoption." |
| No other spec or plan addresses title cleanup on taken-over jobs | Holds | grep of `docs/` finds only this spec |
| A `/draft` rules-map node holds the pickup or take-over rule | No | `.claude/skills/draft/rules/nodes/` holds neither; the rules are atoms in `job-session.md` and `take-over.md` |
| §9 Q1: the §5 pickup rewrite admits a title-only write on a held wip job | No | `.claude/skills/drafting-data/references/jobs-run.md` §5, "The pickup rewrite": every statement is guarded `status = 'queued' AND locked_by IS NULL AND plan_approved_at IS NULL` and no step done, so it matches no row on a held job. §5's own guard (`locked_by = '<own token>'`) through `drafting_data__execute` would carry a title-only `UPDATE tickets SET title`, so no new server operation is needed for the write itself. |
| The practitioner-words gate passes a spelling-corrected title on an existing job | No | `.claude/skills/drafting-data/hooks/practitioner-words-gate.py`: `in_turn` allows a corrected spelling only when `new` (an `INSERT INTO tickets`), and the card-cut exemption needs the title to be a run of the card's printed words, which a corrected word is not. The gate would refuse the write unless the hook is extended. |
