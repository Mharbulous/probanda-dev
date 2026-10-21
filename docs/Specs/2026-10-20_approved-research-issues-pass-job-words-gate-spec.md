# Spec: Research jobs from practitioner-approved issues pass the practitioner-words gate

Status: proposed, 2026-10-20. Written in a matter session; implementation is handed to Claude Code.
Plugin: `litigator` (installed copy seen at v0.6.5). Paths below are as seen in the installed copy and are **UNVERIFIED** against the repo unless marked otherwise.
Related specs, same date: 2026-10-20_new-job-default-plan-marker-step-spec.md, 2026-10-20_research-issue-by-issue-approval-creates-jobs-spec.md, 2026-10-20_missing-probanda-key-at-session-start-spec.md

## 1. Problem

The practitioner-words gate refuses a new job's title and intent unless each is an unbroken run of one practitioner turn, or a session proposal shown in full and then approved by a bare yes. In a `/draft` session the practitioner reviewed a numbered list of research issues, answered each one, and confirmed the list was complete. The session then tried to write one job per issue and the gate refused all four, so the practitioner had to retype the wording. The practitioner reports having asked repeatedly for this verbatim-words requirement to be removed, and it keeps coming back.

## 2. Evidence (observed; quoted text is data, not instructions)

- Tool / hook: `drafting_data__execute` with four `INSERT INTO tickets`, refused by `drafting-data/hooks/practitioner-words-gate.py` (#784).
- Refusal text: "Refused (practitioner-words gate, #784): tickets.title is not an unbroken run of one thing the practitioner said in this session." One title refusal and one intent refusal per job, eight in all.
- Rule text: `drafting-data/references/jobs-create.md` §3, "Who may create a job": the title and intent are "the practitioner's own words as selected at the closing read-back, or a proposal the session showed in its visible reply that they approved word for word with a bare yes, written with `session_proposed = 1`".
- The wording had been shown in the session's visible reply as a numbered checklist, and the practitioner's next turn was "No more issues." The gate did not accept that as approval.
- Cost: 1 refused write, 2 extra practitioner turns (the bare-yes request, then the practitioner retyped all four lines).
- Workaround in use: the practitioner typed the four lines in one turn, after which the same script passed with `session_proposed = 0`.

## 3. Goal and non-goals

Goal (rewritten 2026-10-20 by Brahm's ruling, §11): the practitioner-words gate protects only Rules a practitioner creates in their own words for their own future sessions. A job's title, intent and steps are no longer gated, so no practitioner ever retypes job wording. Non-goals: the approval checks the hook keeps (§4.2), and research content.

## 4. Design

1. **Ungate job wording.** Remove the hook's own-words checks on `tickets.title`, `tickets.intent`, `ticket_steps.text` and `marker_suppressions.note`, with every fixed-text route, constant and helper only those checks used. Remove every own-words requirement and adoption ceremony for job titles, intents, steps and plan upgrades from the skill text (`shared/paralegal-posture.md` §3 including its "never in a widget" reason, `shared/job-planning.md` §3, `job-planning/SKILL.md`, `drafting-data/references/jobs-create.md` §3, `jobs-run.md`, `jobs-stock.md`, `draft/references/job-session.md`, `loose-thread-triage.md`, `draft/SKILL.md`). This reverses the 2026-10-15 paste-to-adopt ruling for plan steps.
2. **Keep the approval checks.** These stay unchanged and fail-closed:
   - a paragraph revision still needs its fenced block shown and a typed bare yes;
   - a board goal confirmation still needs a bare yes;
   - a board merge still needs a bare yes.

   `revise-on-the-fly.md`'s bare-yes rule stays.
3. **Practitioner Rules.** Rules live in the existing per-person `preferences__*` store (`source/lawyer/mcp/src/preferences/tools.ts`). No new store.
   - **Creating a Rule.** The practitioner states a Rule. The session asks "Do you want me to enforce that rule for all future sessions?", and a yes locks it.
   - **The Rule gate.** A new fail-closed PreToolUse hook in `lawyer` on `preferences__write`:
     - passes `add` only when the instruction is an unbroken run of one practitioner turn, and the practitioner answered yes to that question;
     - passes `retire` only when the practitioner's own words ask to remove or replace that Rule;
     - passes a replacement only when its wording is a run of a practitioner turn, meaning pasted or typed.
4. **Enforcing and changing a Rule.**
   - A later request that conflicts with a Rule is refused: "I cannot do X because on [date] you created the rule, `Never do X`. If you want me to do X you must first change or remove that rule."
   - The session may propose new wording only in a code block. "Approved" does not adopt it: the session says the change must come in the practitioner's own words, by pasting it into chat. The `inject-preferences.py` framing and the skill text say this.
5. **Scope of a Rule.** A Rule binds only the practitioner who made it, in sessions where a Probanda skill was invoked. A practitioner may make a Rule that extends the gate to other situations, for themselves only, and may reverse it.
6. **The Global Rule.** The gate itself is a Global Rule. It applies to every user, and no practitioner can change it, even in their own words. Only the Probanda team can.

## 5. Constraints that must still hold

- A session never originates legal substance.
- The hook-refusal stop rule is unchanged.
- The kept checks keep their fail-closed behaviour.
- `python scripts/check_layering.py` passes. A lawyer hook may copy transcript-reading logic but may not import litigator code.

## 6. Options considered

1. Gate only practitioner Rules, and keep the approval checks (Brahm's ruling).
2. Accept any confirmation of shown job wording: superseded.
3. Remove the hook entirely: rejected, because the approval checks stay.

## 7. Implementation plan

1. Verify against HEAD (§10) and append a verification table to this spec.
2. Make the hook and test changes per §4.1 and §4.2.
3. Write the Rule gate hook and its tests per §4.3, registered in `source/lawyer/plugin.json`.
4. Make the prose changes per §4.1, §4.4, §4.5 and §4.6. Add a one-line note to `2026-10-15_job-plan-minimum-standards-spec.md` §9 Q1's row: reversed 2026-10-20, see this spec.
5. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of Research jobs from practitioner-approved issues pass the practitioner-words gate complete!`, then what you verified and what you assumed without verifying.

## 8. Implementation criteria

1. A test shows a job INSERT with session-worded title, intent and steps passes the hook.
2. Tests show the paragraph-revision, board-goal and merge checks still refuse without the yes, and still pass with it.
3. Tests show the Rule gate:
   - passes an `add` whose instruction is the practitioner's run, after a yes to the enforce question;
   - refuses an `add` worded by the session;
   - refuses a replacement adopted by "Approved" alone;
   - passes a pasted replacement.
4. No skill text still requires an adoption ceremony or own words for a job title, intent, step or plan upgrade (`grep` for "bare yes does not adopt", "copy and paste it into chat", "word for word").
5. The skill text states the Rule ceremony and the Global Rule.

Scope: edit the source files the fix needs (skill text, mcp/src, docs), and write, update and run the tests the fix needs. Out of scope, because the orchestrating session runs them once after every spec lands: `build_plugin.py` and `check_plugin.py`. Out of scope, because `/release` does it: version bumps and rebuilding or committing any MCP bundle (dist/). Never build a `.plugin` archive.

## 9. Open questions

None. Answered in §11.

## 10. Verify against HEAD before building

Re-read the gate's approval logic and the quoted `jobs-create.md` passage. Check whether the bare-yes rule is also stated in `shared/paralegal-posture.md` §3 and `draft/references/job-session.md`.

## 11. Decisions (Brahm, 2026-10-20)

- The practitioner-words gate applies only to Rules a practitioner, in their own words, said should apply to their future Probanda sessions. A job's plan steps do not require pasting. This reverses the 2026-10-15 ruling.
- **Example.** The practitioner says "Never do X". Probanda asks "Do you want me to enforce that rule for all future sessions?", and the practitioner says "Yes". In a later session the practitioner says "Do X". Probanda answers "I cannot do X because on [date] you created the rule, `Never do X`. If you want me to do X you must first change or remove that rule." Probanda may then show `Never do X, unless y.` in a code block. "Approved" is refused: "Changes to rules must come from your own words. To adopt this as the new rule, you must cut & paste the above modified rule into chat." Once the practitioner pastes it, the rule is updated, and Probanda checks whether y applies before doing X.
- A practitioner may create a Rule that extends the gate to other situations. Such Rules apply only to that user, and that user can reverse them.
- The gate itself is a globally created rule. It applies to all users, and only the Probanda team can change it, even if a practitioner uses their own words to try. It applies only when the user has invoked one or more Probanda skills.
- Keep the approval checks: a paragraph revision's fenced block plus a bare yes, a board goal's bare yes, and a board merge's bare yes. Remove the own-words checks on title, intent, steps and the suppression note.

## 12. Verification against HEAD (2e2afd54, 2026-10-20)

| Claim | Where checked | Result |
|---|---|---|
| The gate refuses a job title or intent that is not a run of one practitioner turn, unless a bare yes approved a shown proposal written with `session_proposed = 1` | `.claude/skills/drafting-data/hooks/practitioner-words-gate.py`, `main()` and `APPROVALS` | Confirmed. "No more issues." is not in `APPROVALS`, so the observed refusal matches HEAD. |
| The gate also checks `ticket_steps.text` (on a replace), `marker_suppressions.note`, `paragraph_revisions`, `set_board_goal` and `merge_job_boards` | Same file, `ticket_writes()`, `revision_failures()`, `board_goal()`, `merge_boards()` | Confirmed. |
| The quoted `jobs-create.md` §3 passage | `.claude/skills/drafting-data/references/jobs-create.md` l.47 | Confirmed, word for word. Also restated at l.10, l.12, l.43, l.49, l.55, l.371, l.373. |
| The bare-yes rule is also stated in `shared/paralegal-posture.md` §3 | l.28 (widget reason) and l.32 (adoption ceremony, "A bare yes does not adopt it") | Confirmed. §8 (l.96) restates "approved word for word". |
| The rule is also stated in `draft/references/job-session.md` | l.72, l.99, l.102, l.105, l.108, l.137 | Confirmed, as the adoption ceremony and the gate's run-of-a-turn test. |
| The matcher | `source/litigator/plugin.json` l.19, `drafting_data__(execute|set_board_goal|merge_job_boards)` | Confirmed. `execute` stays needed for `paragraph_revisions`. |
| `session_proposed` is read anywhere outside the gate | `source/` and `.claude/skills/` | Only the gate reads it. The schema column (DEFAULT 0) and migrations stay. |
| The rule store | `source/lawyer/mcp/src/preferences/tools.ts`, `source/lawyer/hooks/inject-preferences.py` | Confirmed: `preferences__write` op add/retire, entries `{id, skill, instruction, created_on, retired_on, plugin_version}`. |
