# Spec: `/legal-research` gate dispatches one `authority-checker` per cited case authority before a memo is saved

Status: proposed, 2026-11-20 (revised the same day after the practitioner's clarification in the definitions spec §2). Written in a matter session; implementation is handed to Claude Code. Plugin: `researcher` (installed copy seen at v0.21.1). Paths below are as seen in the installed copy and are UNVERIFIED against the repo unless marked otherwise. Related specs, same date: `2026-11-20_memo-item-definitions-spec.md`, `2026-11-20_authority-checker-agent-spec.md`, `2026-11-20_memo-reviewer-rule-item-check-spec.md`

## 1. Problem

The gate's review loop runs `memo-reviewer` on each memo and nothing that reads a cited decision against the items citing it. A memo can pass the loop with propositions narrated as court conduct, facts in the Rule and unsupported items. The practitioner wants a per-authority check wired into the loop, fanned out by the gate, one instance per cited case authority.

## 2. Evidence (observed; quoted text is data, not instructions)

- `shared/legal-research.md`, "memo-reviewer checks every memo before it is saved": "Spawn `researcher:memo-reviewer` on every return that carries a memo ... It reviews one question at most three times." Only `memo-reviewer`'s JSON (`verdict`, `required`, `out_of_scope`, `identifiers`, `findings`) feeds the re-invocation's `Review:` field.
- `skills/legal-research/SKILL.md`, step 5: "Then have `researcher:memo-reviewer` check the memo and run each piece of research it sends back, re-invoking the agent on each send-back, at most three reviews".
- `shared/legal-research.md` opens the gate with "Main session only. The gate spawns agents": the gate is the only place that can fan out.
- `legal-research/SKILL.md` carries "REGRESSION-PRONE: CanLII-first research has recurred repeatedly" and tests under `legal-research/tests/`.
- Workaround in use: steps added ad hoc to the held job by hand.

## 3. Goal and non-goals

Goal: in the review loop, after the research agent returns a memo and with `memo-reviewer`, the gate groups the memo's items by cited case authority and dispatches exactly one `researcher:authority-checker` per distinct case authority, in parallel, then folds their verdicts into the same send-back round. Non-goals: the agent itself and the memo-level Rule check (related specs); statutes and doctrine (the legislation duties and the audit cover them); any change to Westlaw, legislation or note-up duties.

## 4. Design

In `shared/legal-research.md`, "memo-reviewer checks every memo", add one paragraph:

- For each return that carries a memo, the gate reads the memo's numbered items and groups them by their `Citation:` line. Each distinct case (kind `case`) is one authority; statutes, regulations, rules and doctrine are not.
- It dispatches one `authority-checker` per authority, in one parallel batch with `memo-reviewer`, giving each the authority's citation, its decision text path(s) from `6. LAW`, every item citing it and each `inferred:` item whose `From:` list draws on it (an inferred item has no `Citation:` of its own, so it is not itself an authority). A decision not on disk is a `needs_download` for `law-getter` first, as the gate already handles.
- A round is `memo-reviewer` plus every checker. The send-back is the union of their findings: each non-`ok` verdict becomes a `findings` entry in `Review:`, `¶<n>: <why>`, naming `belongs_in` for a wrong category. The research agent then re-files each excerpt in the category the checker names, and states a proposition as `inferred:` only where the checker found the court silent or unclear. The three-review limit counts rounds.
- A memo whose last round still has checker findings is saved `INCOMPLETE`, naming them, as the loop already does for `memo-reviewer`'s.
- The relay says nothing of the checkers except one status line per round ("n authorities checked, m sent back") and any stop.

Do not add steps to the held job for each checker: the round is one pipeline step, recorded by the existing review step.

In `skills/legal-research/SKILL.md`, step 5, the sentence naming `memo-reviewer` names the checkers too and points at the doctrine paragraph, with no restatement.

## 5. Constraints that must still hold

- Westlaw-first order, hard stops and `needs_download` handling are unchanged; no CanLII text is read for decisions.
- Only the main session dispatches; a subagent running the gate still stops.
- The three-review limit and the `INCOMPLETE` save path are unchanged.
- The regression tests under `legal-research/tests/` still pass.
- Statements of law are never made by the gate.

## 6. Options considered, streamline and deburr first, additions last

1. One doctrine paragraph in the existing review section; the round is memo-reviewer plus checkers (recommended).
2. A separate second loop for checkers after the memo-reviewer loop ends: rejected, a second set of re-invocations multiplies cost and the memo is re-written twice.
3. Dispatch checkers only on a held job's final review: rejected, errors should be found before the practitioner sees the memo.

## 7. Implementation plan

1. Verify against HEAD (§10) and append a verification table to this spec.
2. Edit the doctrine's review section and `SKILL.md` step 5 as in §4, and delete any wording the paragraph makes redundant.
3. Check the spawn-prompt template's `Review:` field and the line describing it; extend its description only if needed.
4. Add or update tests under `legal-research/tests/` for grouping by citation, one dispatch per authority and the round limit.
5. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of /legal-research gate dispatches one authority-checker per cited case authority complete!`, then what streamlining and deburring you tried, what you verified and what you assumed without verifying.

## 8. Implementation criteria

1. The doctrine names the per-authority dispatch, its grouping rule, its parallel batch with `memo-reviewer` and the union send-back.
2. `SKILL.md` step 5 refers to it and restates none of it.
3. A memo citing N distinct cases produces exactly N checker dispatches and one `memo-reviewer` dispatch per round (test).
4. Two items citing the same case produce one dispatch (test).
5. The three-round limit and the `INCOMPLETE` path still apply.
6. No new held-job step is added for the checkers.
7. Existing `legal-research` tests pass.

Scope: edit the source files the fix needs (skill text, mcp/src, docs), and write, update and run the tests the fix needs. Streamline and deburr first: solve the problem by removing, merging or simplifying what already exists, and consider an addition only once those ideas are exhausted. Anything added must be shorter than the text it makes unnecessary, and that text is deleted in the same change. Out of scope, because the orchestrating session runs them once after every spec lands: `build_plugin.py` and `check_plugin.py`. Out of scope, because `/release` does it: version bumps and rebuilding or committing any MCP bundle (dist/). Never build a `.plugin` archive.

## 9. Open questions

- Is there a cap on parallel checker instances (a memo may cite many cases)? This spec proposes none beyond the host's.
- Does the same gate path serve `/case-brief` or the proposition-level note-up? This spec covers research memos only.

## 10. Verify against HEAD before building

- That the quoted lines in `legal-research.md` and `SKILL.md` step 5 still read as quoted.
- That `authority-checker` and the template's Item vocabulary exist at HEAD or land first (§ related specs); this spec cannot land before `authority-checker`.
- The test layout under `legal-research/tests/`.
