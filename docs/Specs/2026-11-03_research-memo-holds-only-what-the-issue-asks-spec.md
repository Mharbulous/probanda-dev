# Spec: research memo holds only what its Issue asks

Status: proposed, 2026-11-03. Written in a matter session; implementation is handed to Claude Code.
Plugin: `researcher` (installed copy seen at v0.12.1; `/legal-research`, `researcher:research-agent`, `researcher:memo-reviewer`). Paths below are as seen in the installed copy and are **UNVERIFIED** against the repo unless marked otherwise.
Related specs, same date: `2026-11-03_research-memo-whole-issue-in-bold-spec.md`, `2026-11-03_legal-research-rules-served-by-operation-spec.md`.

## 1. Problem

A research job's memo answered far more than its Issue asked, and memo-reviewer accepted it. The Issue asked one thing: what remedies the holder of an interim injunction has to prevent further breaches of it. The Conclusion, and the Rule and Application under it, also set out how to apply for contempt, what must be proved, how knowledge is shown, the court's discretion to decline, the purpose of the sanction, contempt by non-parties, and how one judge adjourned one application. The practitioner judged that none of that should have reached the memo. Every off-scope paragraph adds reading, note-up work and review work, and it blurs the answer.

Nothing in the pipeline tests whether a finding already held answers the question. The scope test runs one way only, on research not done. Each held authority therefore flows into the memo, and the reviewer's single scope question does not catch topic-adjacent text.

## 2. Evidence (observed; quoted text is data, not instructions)

- The memo was saved, so by the gate's rule a memo-reviewer review accepted it. The reviewer's JSON for this memo is **not recoverable** in this session.
- Conclusion: an opening sentence, then 12 bold-labelled bullets. The practitioner ruled 5 bullets plus the opening sentence in scope and **7 of 12 bullets out of scope**: Procedure, What must be proved, Knowledge, Discretion, Purpose of the sanction, Non-parties, Adjournment with leave to return.
- Rule: 26 numbered items. Items 4-6, 8-16, 20-23 and 26 back the off-scope bullets, about **17 of 26**. Item 17 is mixed.
- Application: 10 numbered items. Five (two on elements, two on non-parties, one on evidence) back off-scope bullets.
- The template wants "A Conclusion is one paragraph answering the Issue". This Conclusion was a 13-part list, and nothing checks the shape (source: `shared/research-memo-template.md`).
- Protocol Step 4: "**The scope test.** Research is required only if the Issue, as framed, cannot be answered without it. For each piece of research not done, ask: can the Issue be answered without it?" (source: `shared/legal-audit-protocol.md` Step 4). The test covers research **not done** only.
- Protocol Step 4: "**The memo always answers.** ... Its Conclusion answers the Issue from the sources held: the principle(s) with pinpoint citations, the factual comparison and the distinguishability flags." No rule limits held material to what answers the question.
- Template, "A job's memo": "No other issue or topic heading: a further finding is a Step 5 offer." It bans a second heading, not off-issue content under the one Issue.
- memo-reviewer Review step 2 applies the same test to "any part of the memo's body beyond the Issue": "can the Issue, as framed, be answered without it?" ... "Yes, and the memo itself raises it: an `out_of_scope` item". "Beyond the Issue" is never defined. Nothing tests each Rule and Application item, or each Conclusion sentence (source: `researcher/agents/memo-reviewer.md`).
- No item has to support a Conclusion sentence, so an orphan Rule or Application item has no route out.
- Workaround in use: none. The practitioner caught it on reading the memo, and the memo is still DRAFT.

## 3. Goal and non-goals

Goal: a memo states only what answers its Issue's question **as asked**. The reviewer sends back every Conclusion sentence, and every Rule, Explanation and Application item, that answers some other question. Material found but not asked for leaves the memo as a Step 5 offer.

Non-goals: no change to the Issue rules A to D, the tier order, note-up, the save route, or the job and step mechanics. No new reviewer list key.

## 4. Design

One responsiveness test, stated once in protocol Step 4 and applied by both the writer and the reviewer, replaces the one-way test.

- **Responsive.** A passage is in scope only if it answers the Issue's question as asked. A passage answering a neighbouring question is out of scope unless the Issue asks it. Neighbouring questions include what must be proved to get the thing asked about, how to apply for it, when it is refused, why it exists, against whom else it runs, and how a court managed a hearing. Out-of-scope material goes to Step 5 as an offer, never into the memo.
- **Required research** keeps today's rule: research not done is required only if the Issue cannot be answered without it.
- **Every item serves the Conclusion.** Each Rule, Explanation and Application item supports a sentence of the Conclusion. An item that supports none is out of scope.
- **Conclusion shape.** One paragraph, as the template already says. The reviewer sends back a Conclusion that is a list or more than one paragraph (not counting the open-issues paragraph).
- **memo-reviewer step 2** applies the responsiveness test to each Conclusion sentence and each numbered item by `¶<n>`, emitting `out_of_scope` items. The step-2 test for open research stays as it is.

## 5. Constraints that must still hold

- The reviewer states no law. It judges only what the Issue asks and whether a passage answers that.
- "The memo always answers" stands: an Issue part no held authority answers still gets its `No authority located in <tiers>.` sentence.
- The `required` / `out_of_scope` / `identifiers` / `findings` JSON shape and the gate's three-review loop are unchanged.
- A cited case's history check stays required.
- Step 5 offers stay out of the memo body.

## 6. Options considered, streamline and deburr first, additions last

1. **Recommended.** Rewrite Step 4's scope test as the two-way responsiveness test above, and delete the template's "No other issue or topic heading" sentence, which the new test makes unnecessary. Rewrite memo-reviewer step 2 to point at that one test, applied per sentence and per `¶<n>`, and delete its own restatement of the test. Net text should shrink or stay flat.
2. Add a separate "responsiveness" check to memo-reviewer only. This catches it late, after a full audit run, and leaves the writer free to keep doing it.
3. Cap the number of Conclusion bullets. This treats the symptom, and a capped Conclusion can still be off-scope.

## 7. Implementation plan

1. Verify against HEAD (§10) and append a verification table to this spec.
2. Check `2026-11-03_legal-research-rules-served-by-operation-spec.md`. If it has landed or is in progress, edit the Step 4 text wherever it now lives and is served from, never a stale copy.
3. Rewrite protocol Step 4's scope test as §4's responsiveness test, keeping required-research wording intact. Add "every item serves a Conclusion sentence" to Step 6's memo bullets or to the template, whichever already owns item rules, and do not add it to both.
4. Template: delete "No other issue or topic heading: a further finding is a Step 5 offer." if the new test covers it, and keep "A Conclusion is one paragraph".
5. memo-reviewer: rewrite Review step 2 to apply the protocol's test to each Conclusion sentence and each numbered item (`¶<n>: <words>`), and to send back a Conclusion that is not one paragraph. Update its description line if it restates the old test.
6. Add or extend tests (UNVERIFIED location, `legal-research/tests/` was named in the gate's regression comment). One fixture memo with an off-question Rule item and a bulleted Conclusion must produce `out_of_scope` items. A responsive memo must stay `complete`.
7. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of research memo holds only what its Issue asks complete!`, then what streamlining and deburring you tried, what you verified and what you assumed without verifying.

## 8. Implementation criteria

1. Protocol Step 4 states one scope test that applies both to research not done and to material held, and it defines "out of scope" as answering a question the Issue does not ask.
2. The test names at least these neighbouring questions as out of scope unless asked: proof, procedure, refusal or discretion, purpose, other persons.
3. memo-reviewer step 2 applies that test to each Conclusion sentence and each numbered item, quoting `¶<n>`, and no longer restates its own version of the test.
4. memo-reviewer sends back a Conclusion that is not one paragraph (open-issues paragraph excepted).
5. An item supporting no Conclusion sentence is out of scope by a rule stated once.
6. Out-of-scope material is routed to Step 5 offers, and the memo body holds no offer.
7. Net line count of the edited rule text is no larger than before, or each added line is offset by deleted text.

Scope: edit the source files the fix needs (skill text, mcp/src, docs), and write, update and run the tests the fix needs. Streamline and deburr first: solve the problem by removing, merging or simplifying what already exists, and consider an addition only once those ideas are exhausted. Anything added must be shorter than the text it makes unnecessary, and that text is deleted in the same change. Out of scope, because the orchestrating session runs them once after every spec lands: `build_plugin.py` and `check_plugin.py`. Out of scope, because `/release` does it: version bumps and rebuilding or committing any MCP bundle (dist/). Never build a `.plugin` archive.

## 9. Open questions

- Should the out-of-scope list of neighbouring questions sit in the protocol (the writer reads it) and be referenced by memo-reviewer, or the reverse? Recommended: protocol owns it, reviewer points to it.
- Does a memo already saved on a job need a migration or re-review route, or does the next re-invocation with `Review:` suffice? Recommended: no migration. The practitioner's memo is re-reviewed under the new rule on its next send-back.

## 10. Verify against HEAD before building

| Claim | Where | Check |
|---|---|---|
| Step 4 scope test covers only research not done | `shared/legal-audit-protocol.md` Step 4 | UNVERIFIED |
| "The memo always answers ... from the sources held" sets no responsiveness limit | same | UNVERIFIED |
| Template: "No other issue or topic heading: a further finding is a Step 5 offer." | `shared/research-memo-template.md` | UNVERIFIED |
| Template: "A Conclusion is one paragraph answering the Issue" | same | UNVERIFIED |
| memo-reviewer step 2's test and "beyond the Issue" wording | `researcher/agents/memo-reviewer.md` | UNVERIFIED |
| Nothing checks Conclusion shape or per-item responsiveness | memo-reviewer, protocol, template | UNVERIFIED |

## 11. Verified against HEAD (2cf1c2f0, 2026-11-03)

Every claim holds. Paths are under `.claude/skills/` except memo-reviewer's, `source/researcher/agents/memo-reviewer.md`.

| Claim | Where at HEAD | Result |
|---|---|---|
| Step 4 scope test covers only research not done | `shared/legal-audit-protocol.md:268-273` | Holds: "For each piece of research not done, ask" |
| "The memo always answers ... from the sources held" sets no responsiveness limit | same, 276-281 | Holds. Its only exclusion is a proposition that could not be pinpointed |
| Template: "No other issue or topic heading: a further finding is a Step 5 offer." | `shared/research-memo-template.md:142` | Holds |
| Template: "A Conclusion is one paragraph answering the Issue" | same, 143 | Holds |
| memo-reviewer step 2's test and "beyond the Issue" wording | `memo-reviewer.md:39`, description at 5-6 | Holds: "beyond the Issue" is not defined |
| Nothing checks Conclusion shape or per-item responsiveness | memo-reviewer steps 1-4, protocol Steps 4 and 6, template | Holds. Reviewer step 4 tests Application items for one finding only, and `mcp/src` has no memo Conclusion check |
| `2026-11-03_legal-research-rules-served-by-operation-spec.md` has not moved Step 4 | `git log` on the protocol | Holds: Step 4 still lives in `shared/legal-audit-protocol.md` |
