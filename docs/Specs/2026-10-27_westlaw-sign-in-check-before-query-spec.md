# Spec: A Westlaw run starts by checking sign-in, out loud

Status: proposed, 2026-10-27. Written in a matter session; implementation is handed to Claude Code.
Plugin: `researcher` (installed copy seen at v0.10.3); the research-paralegal playbook was served from `lawyer` v0.10.7. Paths below are as seen in the installed copy and are **UNVERIFIED** against the repo unless marked otherwise.
Related specs, same date: 2026-10-27_standard-research-plan-spec.md

## 1. Problem
The main session dispatched `research-paralegal` in deep-research mode in the background, four times, before anyone knew whether Chrome and Westlaw were ready. Three runs failed on arrival: twice the Claude in Chrome permission prompt timed out unanswered, once Westlaw was not signed in. Each cost a dispatch and a round trip, and the practitioner learned only afterwards that he was needed. Brahm (2026-10-27): querying was the right step and the query was right, "but just the details of and mechanics of how you actually do run a Westlaw query were apparently not delivered to you, or you didn't get those instructions in time."

## 2. Evidence (observed; quoted text is data, not instructions)
- Run 1 return: "status: blocked (chrome-not-connected) / detail: not-connected (Chrome permission prompt unanswered)" after navigate succeeded and screenshot failed: "No response to the Claude in Chrome permission prompt before it timed out, so the action was not run."
- Run 2 return: "status: blocked (chrome-not-connected) / detail: not-connected (Chrome is connected, but the Claude in Chrome permission prompt for navigation timed out twice, so no navigation ran)".
- Run 3 return: "status: blocked (westlaw-not-signed-in) ... redirected to the Thomson Reuters sign-in page ... I typed no credentials".
- Run 4 started once the practitioner had signed in and was watching Chrome.
- `legal-research/SKILL.md` step 3: "If it returns `status: blocked (chrome-not-connected)` or `status: blocked (westlaw-not-signed-in)`, stop the whole question ... tell the practitioner". The check happens only after a full background dispatch.
- Cost: three wasted paralegal dispatches (~24–27k tokens each, 38–92 s each) and three practitioner round trips.
- Workaround in use: re-dispatch after the practitioner signs in and is told to click Allow.

## 3. Goal and non-goals
Goal: before a Westlaw query is submitted, the session announces each sub-step and stops for the practitioner at the first one it cannot pass, in this order:
  1. Say "I'm navigating to the Westlaw Advantage Canada page", and navigate there.
  2. Determine whether it is signed in. If it is, say so and go on. If not, say: "I've navigated to the Westlaw page, but it is not signed in, and I'm prohibited from entering login information," and wait.
  3. Within Westlaw, make sure it is tracking time to the correct client and client-matter number, and say so.
  4. Once that is confirmed, submit the query.
Non-goals: what is queried (sibling spec); downloads and filing after the query.

## 4. Design
Split the paralegal's deep-research run so sub-steps 1–3 run in the foreground, with the main session relaying each result before the next (a short `check` mode, or the main session's own first call), and only sub-step 4 onward runs in the background. Before sub-step 1 the session tells the practitioner to watch for and Allow the Claude in Chrome permission window, because it times out quickly. A failure at sub-step 1 or 2 stops before any query exists.

## 5. Constraints that must still hold
- Never type credentials.
- Fail-closed client-matter gate before submitting.
- One Chrome owner at a time (paralegal / citation-checker singleton).
- Westlaw stops remain hard stops; no CanLII fallback.
- Internals confidentiality: the practitioner sees plain words, not agent or tool names.

## 6. Options considered, removal first
1. Move the sign-in and client-matter checks to the front as a foreground check that reports before the background run; delete the after-the-fact stop wording it replaces (recommended).
2. Keep one background dispatch but have the main session warn about Allow and sign-in beforehand. Cheaper, but still learns the state only after a dispatch.
3. Do nothing: each unready browser costs a full dispatch and a round trip.

## 7. Implementation plan
1. Verify against HEAD (§10) and append a verification table to this spec.
2. Add the foreground check (navigate, signed-in state, client-matter) to the paralegal playbook and agent contract, returning one status per sub-step.
3. Rewrite `legal-research/SKILL.md` step 3 and `shared/legal-research.md` duty 3 so the session announces sub-steps 1–3 in the practitioner's words of §3, stops at a failed one, and dispatches the background query only after all pass; delete the text this replaces.
4. Tests: an unsigned Westlaw yields the §3 sentence and no query dispatch; a signed-in Westlaw with the wrong client-matter stops before submit; the happy path announces three lines then dispatches.
5. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of A Westlaw run starts by checking sign-in, out loud complete!`, then what you verified and what you assumed without verifying.

## 8. Implementation criteria
1. No deep-research query is dispatched before sign-in and client-matter are confirmed.
2. The session's text announces navigating to Westlaw Advantage Canada, the sign-in state, and the client-matter state, in that order.
3. An unsigned Westlaw produces the §3 not-signed-in sentence and a wait, with no credentials typed.
4. The practitioner is told to Allow the Claude in Chrome permission window before the first browser action.
5. The after-the-fact stop text replaced by the front check is deleted.

Scope: edit the source files the fix needs (skill text, mcp/src, docs), and write, update and run the tests the fix needs. Fix by deleting before adding: anything added must be shorter than the text it makes unnecessary, and that text is deleted in the same change. Out of scope, because the orchestrating session runs them once after every spec lands: `build_plugin.py` and `check_plugin.py`. Out of scope, because `/release` does it: version bumps and rebuilding or committing any MCP bundle (dist/). Never build a `.plugin` archive.

## 9. Open questions
- Should the same front check apply to `citation-checker` (KeyCite), which also needs a signed-in Westlaw?
- Later sub-steps of a Westlaw run (after submit) are not yet settled.

## 10. Verify against HEAD before building
Confirm where the paralegal's playbook lives (lawyer plugin's skill source vs researcher), its current client-matter gate, how the main session dispatches it (background by default), and whether a foreground mode exists. Mark what differs and append the table to this spec before changing code.
