# Spec: New agent `authority-checker`: one instance per cited case authority checks how the memo classified and used that decision

Status: proposed, 2026-11-20 (revised the same day after the practitioner's clarification in the definitions spec §2). Written in a matter session; implementation is handed to Claude Code. Plugin: `researcher` (installed copy seen at v0.21.1). Paths below are as seen in the installed copy and are UNVERIFIED against the repo unless marked otherwise. Related specs, same date: `2026-11-20_memo-item-definitions-spec.md`, `2026-11-20_memo-gate-per-authority-review-spec.md`, `2026-11-20_memo-reviewer-rule-item-check-spec.md`

## 1. Problem

No component reads a cited decision against the memo items that cite it. `memo-reviewer` reads only the memo and its notes and never opens a decision. A memo reached the practitioner with excerpts filed in the wrong category (context facts and applied law in the Rule, a rule narrated as a holding) and with items worded beyond what their excerpt does. The practitioner wants one reviewer per cited case authority, each focused on that one decision, checking that each excerpt taken from it is classified correctly as a proposition, a context fact or applied law, that the sentence stays within its category, and that the cited paragraphs support it.

## 2. Evidence (observed; quoted text is data, not instructions)

- `agents/memo-reviewer.md` description: "Reviews one research memo and its internal notes ... Returns strict JSON. Read-only". Its Restrictions: "You read only the two rule files and the `Memo:` and `Notes:` paths. You never list a folder or open any other file".
- `agents/memo-reviewer.md` step 4 checks form for Application items only.
- `agents/verify-claim.md` (description): "Checks one legal claim ... against the single document it names, adversarially, in an isolated session, and returns a strict verdict JSON object". One claim per instance, dispatched by `/verify-law`, not by the memo gate.
- `shared/legal-research.md`: "The gate spawns agents. If the Agent tool is not in your tool list (you are a subagent), stop". A subagent cannot spawn agents, so the fan-out must be done by the gate, not by a reviewing agent.
- `shared/authority-claim-verification.md` section 3 holds the "whose reasons" rule; `shared/legal-audit-protocol.md`, "Excerpts", holds the pinpoint and excerpt rules.
- The practitioner's account (definitions spec §2): classifying an excerpt as a proposition, a context fact or applied law is mostly about the case's own words; a proposition is inferred only when the court states it poorly or not at all.
- Workaround in use: the held job gains steps such as "Run the verbatim check on the ... Rule excerpts" and "Confirm each ... is the court's own reasoning", worked ad hoc; none tests the category.

## 3. Goal and non-goals

Goal: a new read-only agent, `researcher:authority-checker`, instanced once per distinct cited case authority. Given one decision and every memo item citing it, it returns a strict JSON verdict per item. Non-goals: finding additional authorities or missing excerpts, stating law, checking statutes or doctrine, the gate wiring and the memo-level surface check (related specs).

## 4. Design

Input (from the gate): the authority's citation; the decision's text path(s) on disk; each memo item citing it as `¶<n>` with its section, sentence, tag (`fact:`, `law-applied:` or `inferred:`), pinpoint, excerpt and, for an inferred item, its `From:` list; the paths of the template and the audit protocol. It reads the template's Item vocabulary and `authority-claim-verification.md` section 3 itself with `skill_source__read` and never works from memory of them. It never opens another decision.

For each item it reads the whole paragraph at the pinpoint, decides from the court's own words what that paragraph does, and returns one verdict:
- `ok`
- `wrong_category`: the excerpt is, by its words, a proposition, a context fact or applied law, but is filed as another; names `belongs_in`
- `mixed_excerpt`: the paragraph does more than one of these; names which sentences do what, so the memo cites it once per category
- `sentence_drift`: the sentence says more or other than its category's content in the excerpt (a proposition sentence that narrates or names the court; a fact sentence that generalises; a holding added to a fact)
- `unsupported`: the cited paragraphs do not say it
- `overstated`: they say less, or something conditional
- `wrong_voice`: counsel's argument, a headnote, a rejected or merely recited authority, or an unresolved recital (the recital rule)
- `misquoted`: the excerpt is not verbatim at the pinpoint
- `partial_excerpt`: a sub-paragraph excerpt

For an `inferred:` item, the checker judges only this decision's part: each `From:` item drawn from this decision is classified correctly, and the verdict `court_states_it` is returned, with its pinpoint, when this decision states the rule outright, so the memo should use the court's own words. Whether the facts and applications together entail the inferred rule is not judged here (§9).

Each non-`ok` verdict carries the item's `¶<n>` and one line saying what is wrong. A `reworded` field may offer the item's sentence trimmed to what the paragraph supports, never new law.

Output: one JSON object `{authority, verdict: complete|send_back, items: [{para, verdict, why, belongs_in?, pinpoint?}], unreadable?}`. A decision it cannot read returns `unreadable: <error>` and no verdicts. The agent states no law: it compares the memo's sentence with the decision's text only.

Shape follows `memo-reviewer.md`: fresh-context spawn, lane line, tools limited to `skill_source__read` and the research-folder reader (both prefixes), no writes. Instances are parallel-safe and use no Chrome.

## 5. Constraints that must still hold

- No client or matter content is read or returned; the agent sees the memo's items and one decision only.
- It writes nothing and states no law.
- The recital rule and the excerpt rules are cited from their files, not copied.
- A subagent never spawns agents: instancing is the gate's job.

## 6. Options considered, streamline and deburr first, additions last

1. New agent `authority-checker`, one instance per authority, reusing the template's definitions and the recital rule by reference (recommended).
2. Extend `verify-claim` to take all of one authority's claims in one call and add the category verdicts: fewer agents, but `verify-claim` is dispatched by `/verify-law` for another purpose and widening it couples the two flows.
3. Add the decision-reading to `memo-reviewer`: rejected, one reviewer reading every decision loses the single-authority focus that is the point.

## 7. Implementation plan

1. Verify against HEAD (§10) and append a verification table to this spec.
2. Read `agents/memo-reviewer.md` and `agents/verify-claim.md`; decide in writing whether option 1 or 2 stands and say why.
3. Write `agents/authority-checker.md` in `memo-reviewer`'s shape.
4. Register it wherever agents are listed (plugin manifest, roster, any tool-grant table).
5. Add tests: a fixture decision and memo items with one case of each verdict.
6. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of New agent authority-checker complete!`, then what streamlining and deburring you tried, what you verified and what you assumed without verifying.

## 8. Implementation criteria

1. `researcher:authority-checker` exists, is registered like `memo-reviewer`, and has no write tool.
2. Its instructions read the template's Item vocabulary and the recital rule by path and copy neither.
3. Its output is the JSON above, with each verdict value defined once.
4. Given a fixture decision and items that file a context fact in the Rule, file a rule as applied law, put two categories in one item, narrate a court in a proposition sentence, cite a recital, misquote, and cite paragraphs that do not say the sentence, it returns the matching verdict for each, and `ok` for a clean item.
5. Given an inferred item whose `From:` items are drawn from a decision that states the rule outright, it returns `court_states_it` with the pinpoint.
6. It cannot be asked to read a second decision.
7. The agent roster and any tool-grant table list it.

Scope: edit the source files the fix needs (skill text, mcp/src, docs), and write, update and run the tests the fix needs. Streamline and deburr first: solve the problem by removing, merging or simplifying what already exists, and consider an addition only once those ideas are exhausted. Anything added must be shorter than the text it makes unnecessary, and that text is deleted in the same change. Out of scope, because the orchestrating session runs them once after every spec lands: `build_plugin.py` and `check_plugin.py`. Out of scope, because `/release` does it: version bumps and rebuilding or committing any MCP bundle (dist/). Never build a `.plugin` archive.

## 9. Open questions

- Option 1 or 2 (a new agent, or widening `verify-claim`)? This spec recommends 1.
- Who judges whether an inferred proposition follows from its `From:` items, which may come from several decisions: `memo-reviewer` on the memo's words, one more single call, or the practitioner? This spec leaves it to the memo-reviewer spec.
- Model for the agent: `opus`, as `memo-reviewer`, or cheaper, given one instance per authority?
- What happens to an authority whose decision text is not on disk: an `unreadable` return that the gate treats as a required `needs_download`?

## 10. Verify against HEAD before building

- That `memo-reviewer.md` and `verify-claim.md` read as quoted, and which tools each is granted.
- Where agents are registered and tested.
- That the template's Item vocabulary (the dependency) has landed or is landing first.

## 11. Verification against HEAD (a40b8614, 2026-11-20)

| Check (§10) | Finding at HEAD |
|---|---|
| `memo-reviewer.md` reads as quoted | Source `source/researcher/agents/memo-reviewer.md`. The description and the Restrictions line read as quoted in §2. Step 4 checks form for Application items, and its last bullet sends back a partial excerpt in any numbered item. No step reads a decision or tests an item's category. `model: opus`. |
| `memo-reviewer.md` tools | `skill_source__read` and `research_filing__research_folder`, each under both the `mcp__plugin_lawyer_data__` and the `mcp__remote-devices__plugin_lawyer_data__` prefix, `skills: []`. No Read and no write tool. `research_folder` is confined by the server to the matter's `6. LAW` tree and the research scratchpad (`source/lawyer/mcp/src/files/matter-folder.ts`, `researchFolder`), so it reads a decision on disk. `brief-reviewer.md` holds the same four tools and already reads one decision with them (`Decision:` and `Decision text:`). |
| `verify-claim.md` reads as quoted | Two copies: the agent `source/researcher/agents/verify-claim.md` and the skill-tree mirror `source/skills/verify-law/agents/verify-claim.md`, identical apart from the frontmatter and the lane line. The description reads as quoted. Tools: `Read` only, `model: opus`. It returns `confirmed / rejected / ambiguous` for one bare claim and carries the recital rule inline as a mirror. |
| Subagent-stop quote | The quoted words are in `source/skills/legal-research/SKILL.md` line 42 ("**Main session only.** The gate spawns agents. If the Agent tool is not in your tool ..."), not in `shared/legal-research.md`. The point holds: the gate does the fan-out. |
| Recital rule and excerpt rules | `source/skills/shared/authority-claim-verification.md` §3 holds the marked recital-rule block (§2 is the unsourced-gloss test). `source/skills/shared/legal-audit-protocol.md` lines 44-49, "Excerpts", hold the whole-paragraph pinpoint and excerpt rules. Both are readable with `skill_source__read`. |
| Where agents are registered | `source/assignment.json`, `plugins.researcher.agents` (alphabetical list). `source/researcher/roster.json` lists skills and their sub-folders only, not agents. No script or hook holds a tool-grant table: `scripts/` and the hooks name no reviewer agent. The one grant pin is `source/skills/legal-research/tests/test_law_folder_text.py`, which checks that `research-agent`, `memo-reviewer` and `brief-reviewer` hold the narrow `research_folder` reader and never `matter_folder`. |
| Where agents are tested | Text-pinning unittest files in `source/skills/legal-research/tests/` (`test_memo_reviewer.py`, `test_case_brief.py`), which assert frontmatter, body rules and the `assignment.json` entry. Behaviour fixtures for an agent live as an `evals/evals.json` plus a synthetic decision under `evals/fixtures/` (`source/skills/verify-law/evals/`). |
| Item vocabulary (the dependency) | Landed in a40b8614: `source/skills/shared/research-memo-template.md` lines 131-146 define proposition, context fact, applied law, mixed excerpt and inferred proposition. The inferred proposition has no `From:` list: its sentence opens `inferred:` and its excerpt is the whole paragraph where the court applies the law (practitioner's decision, definitions spec §4 and §9). |
| Option 1 or 2 (§7 step 2) | Option 1 stands. `verify-claim` holds `Read` only, takes one bare claim with no matter context, and serves `/verify-law`; widening it to take one authority's items, their categories and the template would change its contract for its existing caller. A new agent in `brief-reviewer`'s shape reuses the reader, the rule files and the fresh-context spawn as they are. |
