# Spec: Unattended runs write the plan of a plan-marker job themselves, show it on the board as unratified, and work the job

Status: proposed, 2026-11-24. Written in a matter session; implementation is handed to Claude Code. Plugin: `litigator` (installed copy seen at v0.28.0). Paths below are as seen in the installed copy and are **UNVERIFIED** against the repo unless marked otherwise. Related specs, same date: `2026-11-24_work-board-card-skipped-without-card-tool-spec.md`

## 1. Problem

The practitioner sent three background subagents in parallel, each told to take one research job from a Work Board, plan it, and work it. Each job's only step was the plan marker ("Create a plan for how to complete this job."). All three stopped before writing anything, because the rules forbid an unattended run from assigning or planning a plan-marker job, and the unattended-run job filter rejects every such job. Parallel unattended research is therefore impossible for any job outlined in the usual way. Today, planning needs the practitioner present, one job at a time.

The practitioner's intended behaviour, verbatim: "There is no reason that a human needs to review the plan in advance. Subagents should be free to create the plan, and as long as that plan is displayed in the checklist description of each research job, human users can review, modify or ratify those plans later."

## 2. Evidence (observed; quoted text is data, not instructions)

- `/work` job-session rule "A job that needs a plan", as quoted by all three subagents: "In an unattended run nothing is written: the job is not assigned, and the run reports that it needs a plan and stops." (source: litigator `work/references/job-session.md`, served through `skill_rules__applicable`; path UNVERIFIED)
- `shared/job-planning.md` §3 "Unattended": "An unattended run never pauses and never upgrades. Where it meets a plan that falls short, it writes nothing, reports which of sections 1 and 2 the plan lacks, and stops."
- `draft/references/unattended-run.md`: an unattended run "never rewrites", and it chooses only jobs the board marks eligible. Every Ready plan-marker job on the board (6 of 6) read `eligible: no (no_proposal_keys)`. Eligibility requires exactly one step with a Proposal behind it (source: `drafting_forms__board_card` output).
- Cost: 3 subagents, about 150k tokens each and about 90 s each, for zero output (subagent usage reports: 149,051 / 151,159 / 152,022 tokens; 17–19 tool calls each).
- Error text: none. Every run stopped cleanly under the rules.
- Workaround in use: none. The jobs stay Ready and unassigned, and the session offered to plan them with the practitioner present.

## 3. Goal and non-goals

Goal: an unattended run, including a subagent sent to work one named job, may take a plan-marker job and write its plan to the §§1–2 minimum through `/job-planning`. The plan shows as the job's step checklist on the Work Board, marked as not yet ratified by the practitioner. The run then works the job (for a research job, through `/legal-research`) without waiting. The practitioner can later review, modify or ratify the plan.

Non-goals:
- Unattended runs still may not alter steps already done in an existing plan.
- Gates that protect outgoing work are unchanged: sending, filing, saving to the court record, and a client-matter gate on paid research.
- No change to how an attended session plans a job.

## 4. Design

- One provenance marker on a plan: written unattended and not yet ratified. The Work Board shows it in plain words next to the checklist (for example "Plan written without you: review, change or approve"). The practitioner clears it by approving, editing or replacing the plan. Prefer reusing whatever plan-approval state already exists over adding a new field.
- `/job-planning` §3: replace "never pauses and never upgrades … writes nothing … and stops" with: an unattended run writes a plan meeting §§1–2, marks it unratified, and continues. It still never alters a step already done.
- `/work` "A job that needs a plan": an unattended run assigns the job, hands it to `/job-planning`, then dispatches as normal.
- Unattended-run eligibility: a job whose only step is the plan marker is eligible. The `no_proposal_keys` exclusion must not apply to it.
- Where an approval point in a plan written unattended would need the practitioner, the run holds at that step and reports it, as it already does for steps on an existing plan.

## 5. Constraints that must still hold

- No email is sent, nothing is filed, and nothing is deleted without the practitioner.
- Steps already done are never altered.
- Assignment stays exclusive: two sessions never hold one job.
- The client-matter gate on paid research, and the singleton rule for Chrome-driven agents, are unchanged.
- Internals stay confidential in anything the practitioner sees.

## 6. Options considered, streamline and deburr first, additions last

1. **Delete the three unattended-stop clauses, drop the plan-marker case from the eligibility filter, and reuse the existing plan-approval state as the "unratified" marker.** This mostly removes text. Trade-off: one board label may need wording. (recommended)
2. Add a separate "provisional plan" job state. Trade-off: new state, new rendering and more rules to read on every run.
3. Have the orchestrator plan in the attended session and dispatch afterwards. Trade-off: that is today's workaround, and it is serial and needs the practitioner.

## 7. Implementation plan

1. Verify against HEAD (§10) and append a verification table to this spec.
2. Find every rule text and code path that stops an unattended run on a plan-marker job: the `/work` job-session rule, `shared/job-planning.md` §3, `draft/references/unattended-run.md`, the eligibility computation behind `no_proposal_keys`, and any rules-map node holding the same rule. Edit the node file, not the pilot atom, where a node exists.
3. Remove or rewrite those clauses per §4 and option 1.
4. Make the board show a plan written unattended as unratified, reusing existing approval state if possible.
5. Add tests: eligibility accepts a plan-marker job; a plan written unattended carries the unratified marker; the board renders it.
6. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of Unattended runs write the plan of a plan-marker job themselves, show it on the board as unratified, and work the job complete!`, then what streamlining and deburring you tried, what you verified and what you assumed without verifying.

## 8. Implementation criteria

1. No rule text served to an unattended run says to stop, or to write nothing, on a plan-marker job.
2. The unattended eligibility check marks a Ready job whose only step is the plan marker as eligible.
3. A plan written by an unattended run meets job-planning §§1–2 and is marked unratified. Ratification by the practitioner clears the marker.
4. The Work Board shows the plan's steps as the job's checklist, with a plain-words unratified label.
5. Gates in §5 are untouched, and tests for each pass.

Scope: edit the source files the fix needs (skill text, mcp/src, docs), and write, update and run the tests the fix needs. Streamline and deburr first: solve the problem by removing, merging or simplifying what already exists, and consider an addition only once those ideas are exhausted. Anything added must be shorter than the text it makes unnecessary, and that text is deleted in the same change. Out of scope, because the orchestrating session runs them once after every spec lands: `build_plugin.py` and `check_plugin.py`. Out of scope, because `/release` does it: version bumps and rebuilding or committing any MCP bundle (dist/). Never build a `.plugin` archive.

## 9. Open questions

- Should a plan written unattended be worked immediately, or should the run stop after planning when the plan's first step itself costs money (for example a paid deep-research query)? Default per the practitioner: work it, subject to the existing client-matter gate.
- `2026-10-15_job-plan-minimum-standards-spec.md` may already define unattended behaviour for job-planning. Reconcile with it, and do not duplicate it.

## 10. Verify against HEAD before building

Confirm each quoted clause in §2 exists at HEAD and where. Confirm how `no_proposal_keys` is computed. Confirm whether a plan-approval state already exists that can serve as "unratified". Record results in a table appended to this spec.

### Verification at HEAD (7d6c12f7, 2026-11-24)

| Item | Found at HEAD | Where |
|---|---|---|
| §2 quote 1, "In an unattended run nothing is written: the job is not assigned, and the run reports that it needs a plan and stops." | Present, verbatim | `source/skills/work/references/job-session.md`, "A job that needs a plan" (served under atom `work.steps.restated`) |
| §2 quote 2, job-planning §3 "Unattended" | Present, verbatim | `source/skills/shared/job-planning.md` §3 |
| §2 quote 3, an unattended run "never rewrites" | Present, but in `/work`, not in `unattended-run.md` | `source/skills/work/references/job-session.md`, pickup review: "An unattended run never rewrites: it takes only a job holding keys". `draft/references/unattended-run.md` step 2 only says the run chooses the first `eligible: yes` job |
| The tool refusal behind quote 1 | `drafting_data__take_job` refuses any job whose only step is the plan marker with `needs_plan`, for every session | `source/lawyer/mcp/src/submission/forms/take-job.ts` |
| How `no_proposal_keys` is computed | `ticket.proposal_keys.length === 0`, the keys being the job's `ticket_proposals` rows. A plan-marker job has none, so it always fails | `unattended-eligibility.ts` `ineligibleReasons`; keys read in `build-proceeding-board.ts` |
| Other reasons a plan-marker job fails | On a Writing's board with an inventory, none. A research Writing's job is judged with no inventory by design, so it also fails `no_inventory`. On a Work Board with no Writing every job keeps the default `no_inventory` | `build-work-board.ts`; `build-proceeding-board.ts` |
| An existing plan-approval state | `tickets.plan_approved_at`, stamped by `drafting_data__approve_plan`. An attended session stamps it when it announces the plan, before the first step; an unattended run never stamps it | `approve-plan.ts`; `draft/references/job-session.md`, Announce and proceed |
| Can it serve as "unratified"? | Not alone: every Ready job not yet announced also has it NULL. Read with the unattended-class lock the board already reads (`locked_by` starting `sess-unattended-`, which drives "In progress with nobody present") and the absence of Proposal keys (an unattended run takes a keyless job only when it is a plan-marker job), it names exactly a plan an unattended run wrote and nobody has approved. No schema change and no new stored field | `build-proceeding-board.ts` `lock_note`; `unattended-eligibility.ts` `UNATTENDED_TOKEN_PREFIX` |
| A rules-map node holding the same rule | None | `source/skills/draft/rules/nodes/*.md` |
| `2026-10-15_job-plan-minimum-standards-spec.md` | States the old behaviour: an unattended run that meets a sub-minimum plan reports it and stops | that spec, design bullet on unattended runs |
