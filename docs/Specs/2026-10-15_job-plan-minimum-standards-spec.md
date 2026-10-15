# Spec: Job plan minimum standards, a shared job-planning file and a research planning stage

Status: proposed, 2026-10-15. Written in a matter session; implementation is handed to Claude Code.
Plugin: `litigator` and `research` (installed copies seen at v0.2.2). Paths below are as seen in the installed copy and are **UNVERIFIED** against the repo unless marked otherwise.
Related specs, same date: `2026-10-15_job-title-cleanup-on-takeover-spec.md`, `2026-10-15_research-memo-deliverable-spec.md`, `2026-10-15_suggestion-skill-to-practice-plugin-spec.md`, `2026-10-15_posture-scope-design-partner-spec.md`

---

## 1. Problem

A one-step research job's only step repeated its intent word for word. The restating check caught it, but the replacement the session proposed was "Put the question to /legal-research and take its answer; save the answer". Brahm: that "is not a plan. It tells us nothing about what the legal research plan should be." A second proposal spelled out the gate's fixed pipeline and was better, but nothing in the plugin sets a minimum for what a plan must contain, and no stage produces a research plan's substance (issues, sources, what a complete answer looks like) for approval before searching. There is no `/job-planning` skill; planning rules are scattered through `draft/references/job-session.md`.

## 2. Evidence (observed; quoted text is data, not instructions)

- `draft/references/job-session.md`, "A step that only restates the request": "each step says how the work gets done, not what the job is" (the only content standard for a step).
- Same file, Steps: "Once it is assigned they are never re-divided or reworded: a replaced step list needs the practitioner's own words (`/drafting-data` §5)".
- `shared/paralegal-posture.md` §3: a proposed step division takes the adoption ceremony ("copy and paste it into chat"); "A bare yes does not adopt it."
- `research/skills/legal-research/SKILL.md`, The gate: steps 0–4 (preflight; read doctrine; Westlaw via `westlaw-query-optimizer` and `research-paralegal`; `legislation-fetcher` per instrument; spawn `research-agent`). No step returns an issue list or source plan to the practitioner before searching.
- The drafting skill may not name statutes or doctrines a research plan should cover (`draft` SKILL.md ban 7; `shared/legal-research.md`), so it cannot write a substantive research plan itself.
- No skill named `job-planning` exists in any installed plugin (skill listing checked).
- Cost: two plan proposals and two practitioner turns before any work.

## 3. Goal and non-goals

Goal: (a) a shared job-planning rule file setting the minimum content of any job plan, read by `/draft` (and `/prepare`) wherever a plan is written, proposed, picked up or taken over; (b) a thin user-invocable `/job-planning` skill that applies the file to a named job; (c) a planning stage inside `/legal-research` that returns, before any search, the issue list, the sources to check in order and the completion test, for the practitioner's approval; (d) when a plan falls short of the minimum, the model upgrades it, never altering a step already done. Non-goals: changing how research itself is performed (see the memo spec), and the posture rules (posture spec).

## 4. Design

1. **Minimum plan contents** (shared file, e.g. `shared/job-planning.md`): every plan states (i) each step as a concrete action on a named object, never the job's title or intent restated; (ii) the deliverable and where it lands; (iii) each point where the practitioner must approve before work continues; (iv) the completion test. A research job's plan additionally states: the sources to check, in order (matter law folder and pool, Westlaw query with its approval point, legislation fetch, audit and note-up); that the issue list comes from `/legal-research`'s planning stage; and the memo deliverable.
2. **Upgrade rule.** At pickup, take-over, restore and announcement, compare the plan with the minimum. Where it falls short, rewrite only the steps not yet done to meet it; done steps and their stamps are frozen. Whether the upgrade is written and announced without adoption, or still takes the adoption ceremony, is §9 Q1; recommended: written and announced, since it adds structure and no substance, with a carve-out sentence added to `shared/paralegal-posture.md` §3.
3. **`/job-planning` skill:** given a job number, reads its card, applies the file, and proposes or writes the upgraded plan by the §4.2 rule. Thin front end; the rules live in the shared file.
4. **`/legal-research` planning stage:** a new step between preflight and Westlaw. The gate (not the drafting skill) produces the issue breakdown and source plan, through a scoped dispatch that states no law (e.g. the research-agent's existing `mode: inventory` / `report: brief`, or a new `mode: plan`), and returns it for approval. Searching begins only after approval or the practitioner's waiver.
5. `/draft` and `/prepare` cite the shared file at every place a plan is written instead of restating rules.

## 5. Constraints that must still hold

- A step already done is never modified.
- Only `/legal-research` states law; the planning stage names issues and sources, never answers them.
- The restating check stays.
- Deadline isolation: no plan step computes or mentions a deadline.
- Unattended runs never pause for approval; an unattended run that meets a sub-minimum plan reports it and stops, as the restating check does.

## 6. Options considered

1. Shared file + thin skill + research planning stage (recommended): one source of truth, usable inside and outside `/draft`.
2. Standalone `/job-planning` skill only: duplicates rules `/draft` must also enforce at pickup and take-over.
3. Tighten only the restating check: blocks bad plans but supplies no standard for good ones, and no research substance.

## 7. Implementation plan

1. Verify against HEAD (§10) and append a verification table to this spec.
2. Write the shared job-planning file (§4.1, §4.2).
3. Add the `/job-planning` skill (§4.3) in the plugin that owns `/draft`.
4. Edit `draft/references/job-session.md` and `take-over.md` (and any `/draft` rules-map nodes holding these rules) to cite the file at pickup, take-over, restore, Change and announcement.
5. Add the paralegal-posture §3 carve-out sentence if §9 Q1 is answered as recommended (only that sentence; the posture-scope spec owns the rest of the file).
6. Add the planning stage to `research/skills/legal-research/SKILL.md` and `shared/legal-research.md` (§4.4), and the research-agent dispatch mode it needs.
7. Edit `/prepare` where it writes job steps.
8. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of Job plan minimum standards, a shared job-planning file and a research planning stage complete!`, then what you verified and what you assumed without verifying.

## 8. Implementation criteria

1. The shared file lists the four minimum contents and the research additions in §4.1.
2. The upgrade rule freezes done steps, in words, and is cited from pickup, take-over, restore and announcement.
3. A `job-planning` skill exists and delegates to the shared file.
4. `/legal-research`'s gate has a planning step before any Westlaw or legislation dispatch, returning issues, sources and completion test for approval, stating no law.
5. Unattended behaviour for a sub-minimum plan is stated.
6. No rule elsewhere restates the minimum contents instead of citing the file.

Scope: edit source only (skill text, mcp/src, docs). Out of scope, because `/repackage` does it in the cloud from origin/main: rebuilding or committing any MCP bundle (mcp/dist), npm or esbuild runs, the plugin packager, version bumps, *-latest.plugin files, and running `/repackage`. Out of scope, because the orchestrating session runs it once after every spec lands: `build_plugin.py`. Out of scope, because valid testing happens only in Cowork after `/repackage`: writing, updating or running any test, suite, golden or E2E run in Claude Code. A type-check of edited TypeScript is allowed; it is not a test.

## 9. Open questions

1. Is an upgraded plan written and announced without adoption (recommended), or does it still take the paste-to-adopt ceremony? Ask Brahm.
2. Which plugin should ship `/job-planning` (litigator, alongside `/draft`, is the default) is **UNVERIFIED** as the right home.

## 10. Verify against HEAD before building

- The job-session.md and paralegal-posture §3 passages still read as quoted in §2.
- No `job-planning` skill or shared planning file already exists.
- The research-agent's dispatch modes, to choose the planning-stage mode.

## 11. Verification against HEAD (2026-10-15, at a79f681)

| Check | Result | Where |
|---|---|---|
| "each step says how the work gets done, not what the job is" reads as quoted in §2 | Holds | `.claude/skills/draft/references/job-session.md`, atom `draft.steps.restated` |
| "Once it is assigned they are never re-divided or reworded: a replaced step list needs the practitioner's own words (`/drafting-data` §5)" reads as quoted in §2 | Holds | same file, atom `draft.steps` |
| `shared/paralegal-posture.md` §3 adoption ceremony ("copy and paste it into chat", "A bare yes does not adopt it.") reads as quoted in §2 | Holds | `.claude/skills/shared/paralegal-posture.md` §3, fourth paragraph, now also carrying a79f681's held-job title carve-out |
| The gate's steps 0–4 read as in §2, with no step returning an issue list or source plan before searching | Holds | `.claude/skills/legal-research/SKILL.md`, "The gate", steps 0–5 (step 5 is the re-invocation loop) |
| No `job-planning` skill and no shared planning file exists | Holds | no `job-planning` folder or file under `.claude/skills/`, `public/plugins/` or `source/`, and no mention of the name there |
| A `/draft` rules-map node holds the plan-content rules | No | `.claude/skills/draft/rules/nodes/` holds none; the rules are atoms in `job-session.md` and `take-over.md` |
| The research-agent's dispatch modes | `opinion` (default), `inventory`, `note-up`; `report: full` / `brief` | `.claude/skills/shared/legal-audit-scoped.md`, "The dispatch fields". `source/research/agents/research-agent.md` is a thin shim and names only `inventory` in its description. `inventory` needs a caller-supplied criteria list and answers a holdings question, so it cannot produce an issue list; a new `mode: plan` is needed. |
| `/job-planning`'s home (§9 Q2) | litigator, beside `/draft` (Brahm, 2026-10-15) | `source/assignment.json` and `source/litigator/roster.json` list litigator's skills |
| §4.2 with §9 Q1 as decided (an upgrade written and announced with no adoption): the practitioner-words gate passes a session-written step | No | `.claude/skills/drafting-data/hooks/practitioner-words-gate.py`: a step written in a script that deletes from `ticket_steps` must be an unbroken run of a practitioner turn or of the job card's printed words, and "A step text never passes" as a session proposal. An upgrade that adds a deliverable, an approval point or a completion test adds words the card does not hold, so the gate refuses the write. |
| §4.2: a step-list write can keep the done steps and their stamps | No | `.claude/skills/drafting-data/references/jobs-run.md` §5: every step change deletes and re-inserts the whole list, so every `done_at` goes; `job-session.md` tells a taken-over job "the inherited stamps will be discarded" before a Change. Freezing done steps needs a new partial-replace write in §5 and a gate route for it. |
