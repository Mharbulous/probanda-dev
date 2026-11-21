# Spec: `memo-reviewer` tests every Rule item's category and form against the template's item vocabulary

Status: proposed, 2026-11-20 (revised the same day after the practitioner's clarification in the definitions spec §2). Written in a matter session; implementation is handed to Claude Code. Plugin: `researcher` (installed copy seen at v0.21.1). Paths below are as seen in the installed copy and are UNVERIFIED against the repo unless marked otherwise. Related specs, same date: `2026-11-20_memo-item-definitions-spec.md`, `2026-11-20_authority-checker-agent-spec.md`, `2026-11-20_memo-gate-per-authority-review-spec.md`

## 1. Problem

`memo-reviewer` checks the form of Application items and checks scope, identifiers and partial excerpts on every numbered item, but nothing checks that a Rule item holds a proposition. Rule items that recount a court's findings or application ("The court stated ...", "Counsel for the City relayed ...") pass every check it runs, and an unmarked inference passes as readily as a court's own rule.

## 2. Evidence (observed; quoted text is data, not instructions)

- `agents/memo-reviewer.md`, step 4: "Quote each Application item that holds more than one finding, or that is neither a finding of fact nor the law applied to the facts by that item's court". It lists no Rule-item check.
- Same file, step 3: it quotes "each party, counsel, practitioner, matter number, date, amount or document of the working matter", so a case's counsel or parties are not caught.
- Same file, step 1 and the `Conclusion shape` line cover the Issue and a Conclusion's first sentence; nothing covers a Conclusion that narrates decisions.
- Same file, description: "an Issue, Conclusion, Application finding or excerpt that breaks the template's rules": Rule items are not named.
- A saved memo with nine such Rule items and a several-hundred-word narrating Conclusion passed `memo-reviewer` and reached the practitioner.
- The practitioner's account (definitions spec §2): the category of an item is decided by the court's own words, and a proposition the court does not state is inferred and must be labelled so.

## 3. Goal and non-goals

Goal: `memo-reviewer` sends back (a) every Rule or Explanation item whose sentence reads as a context fact or applied law, or narrates a court, instead of a proposition; (b) every `inferred:` item that cites no `From:` items, cites one that does not exist or is not a `fact:` or `law-applied:` item, or sits before the court's own propositions; and (c) a Conclusion whose reasons narrate decisions. Non-goals: reading decisions or deciding what an excerpt does in the court's words (the `authority-checker`); defining the terms (the definitions spec); changing the review limit or the JSON shape.

## 4. Design

Add one step to the Review list, after step 4:

5. Quote each Rule and Explanation item whose sentence is not a proposition as the template's Item vocabulary defines it, because it names a court, judge, counsel, party or decision, says what anyone held, stated, found, adopted, recited or relayed, or states a fact found or a holding: a `findings` item, `¶<n>: <its words>`, noting it reads as a context fact or applied law. Quote each `inferred:` item that has no `From:` list, whose `From:` names an item that does not exist or is not a `fact:` or `law-applied:` item, or that precedes a court's proposition: a `findings` item, `¶<n>: <its words>`. Quote, as an `out_of_scope` item `Conclusion narrates: <its words>`, each Conclusion sentence that narrates a decision's facts or procedure rather than restating a proposition with its pinpoint, and each inferred proposition the Conclusion states without saying it is inferred.

The step names the template block by reference and copies no definition. The description line gains "Rule item" beside "Application finding". The `Memo:` input line stays.

This is a surface check from the memo's words alone. Whether an excerpt is in the right category in the court's words, and whether the cited paragraphs support the item, is the `authority-checker`'s.

## 5. Constraints that must still hold

- `memo-reviewer` reads only the two rule files and the memo and notes paths, and writes nothing.
- It states no law and judges only form against the definitions.
- The JSON shape and verdict rule are unchanged: `findings` non-empty means `send_back`.
- Its instructions read the template, as now; the definitions live only there.

## 6. Options considered, streamline and deburr first, additions last

1. One new numbered step quoting the definitions by reference (recommended).
2. A script that pre-screens for words such as "the court": rejected as the only check, since a proposition may legitimately say "a court may"; it may serve as a hint inside the reviewer only if it removes text.
3. Leave the whole check to `authority-checker`: rejected, a surface failure should be caught even for a statute-based memo with no case authority.

## 7. Implementation plan

1. Verify against HEAD (§10) and append a verification table to this spec.
2. Add the step and the description wording to `agents/memo-reviewer.md`; remove any wording the step makes unnecessary.
3. Add tests: a fixture memo with one Rule item that reads as a context fact, one clean proposition, one inferred item with no `From:`, one clean inferred item and one narrating Conclusion sentence.
4. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of memo-reviewer tests every Rule item's category and form complete!`, then what streamlining and deburring you tried, what you verified and what you assumed without verifying.

## 8. Implementation criteria

1. `agents/memo-reviewer.md` has the new step and cites the template's Item vocabulary by path without copying it.
2. The agent's description names Rule items.
3. On the fixture memo it returns `send_back` with a `findings` entry for the context-fact-reading Rule item and for the inferred item with no `From:`, an `out_of_scope` entry for the narrating Conclusion sentence, and none for the clean proposition or the clean inferred item.
4. A memo with only clean Rule items and a non-narrating Conclusion still returns `complete`.
5. Existing `memo-reviewer` tests pass.

Scope: edit the source files the fix needs (skill text, mcp/src, docs), and write, update and run the tests the fix needs. Streamline and deburr first: solve the problem by removing, merging or simplifying what already exists, and consider an addition only once those ideas are exhausted. Anything added must be shorter than the text it makes unnecessary, and that text is deleted in the same change. Out of scope, because the orchestrating session runs them once after every spec lands: `build_plugin.py` and `check_plugin.py`. Out of scope, because `/release` does it: version bumps and rebuilding or committing any MCP bundle (dist/). Never build a `.plugin` archive.

## 9. Open questions

- Is a Conclusion that narrates reported through `out_of_scope` (as above) or through `findings`? This spec proposes `out_of_scope`, beside the existing `Conclusion shape` entry.
- Should this reviewer also judge whether an inferred proposition follows from its `From:` items (a logic check on the memo's own words, stating no law), or is that left to the practitioner? This spec proposes the reviewer flags it only when the proposition adds a condition no `From:` item mentions.
- Is the Conclusion test conditional on the definitions spec's answer to whether reasons may mention a decision's facts?

## 10. Verify against HEAD before building

- That the quoted step 3 and step 4 lines in `memo-reviewer.md` still read as quoted.
- That the template's Item vocabulary and the inferred item's shape exist at HEAD or land first; this spec cannot land before them.
- The fixture and test layout for `memo-reviewer`.

## 11. Verification against HEAD (a40b8614, 2026-11-20)

| Check (§10) | Finding at HEAD |
|---|---|
| Where the agent is authored | `source/researcher/agents/memo-reviewer.md`, shipped by `researcher` (`source/assignment.json`). |
| Step 3 and step 4 as quoted | Both still read as quoted (lines 46 and 47). Step 4's sub-bullets also send back an Application case with no `fact:` or no `law-applied:` item, and any item with a partial excerpt (lines 48-49). No step checks a Rule or Explanation item. |
| Step 1, Conclusion shape, description | Step 1 tests the Issue by rules A to D (line 41). Step 2's second sentence sends back a Conclusion "whose first sentence or shape breaks the template's rule for it" as an `out_of_scope` item, `Conclusion shape: <its first words>` (line 43). The description reads "an Issue, Conclusion, Application finding or excerpt that breaks the template's rules" (lines 7-8). |
| Item vocabulary | Landed in a40b8614: `source/skills/shared/research-memo-template.md` lines 131-146 define Proposition, Context fact, Applied law, Mixed excerpt and Inferred proposition. |
| Inferred item's shape | The normal item shape (Authority, Citation, Kind, Pinpoint, verbatim excerpt), its sentence opening `inferred:` and stating the rule in the present tense and general terms, its excerpt the whole paragraph where the court applies the rule, placed in the Rule after the court's own propositions (template lines 142-146). It has no `From:` list (definitions spec §4, §9). |
| Conclusion rule | Template lines 164-169: each reason "restates a proposition in the memo's general words, says so when it is inferred, and narrates no decision". |
| How a `Conclusion shape:` item is acted on | `shared/legal-audit-protocol.md` line 294: the audit rewrites "a `Conclusion shape:` item's Conclusion to the template's rule". A new label would need a matching rewrite instruction there. |
| Fixture and test layout | `source/skills/legal-research/tests/test_memo_reviewer.py`: unittest text pins on the agent, the protocol, the template and `shared/legal-research.md`, run as `python <path>`. No fixture memos and no harness that runs an agent exist in the repo. |
