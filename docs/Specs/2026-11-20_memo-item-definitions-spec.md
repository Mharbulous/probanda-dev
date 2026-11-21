# Spec: Research memo items: classify each excerpt as proposition, context fact or applied law, and define the three

Status: proposed, 2026-11-20 (revised the same day after the practitioner's clarification in §2). Written in a matter session; implementation is handed to Claude Code. Plugin: `researcher` (installed copy seen at v0.21.1; `shared/research-memo-template.md` is also shipped in `lawyer` and `litigator`). Paths below are as seen in the installed copy and are UNVERIFIED against the repo unless marked otherwise. Related specs, same date: `2026-11-20_authority-checker-agent-spec.md`, `2026-11-20_memo-gate-per-authority-review-spec.md`, `2026-11-20_memo-reviewer-rule-item-check-spec.md`

## 1. Problem

A saved research memo reached the practitioner with Rule items that were not propositions. The cause is mostly classification, not wording: excerpts that recount what a court found, did or was told (context facts and applied law) were filed in the Rule, and each item's sentence paraphrased that narration ("The court stated ...", "Counsel relayed ..."). Where a decision states no usable general rule, nothing lets the memo state one honestly: it either narrates or states the rule as though the court had. The Conclusion was also one paragraph of several hundred words narrating decision after decision. The template never defines what makes an excerpt a proposition, a context fact or applied law for the Rule, so no reviewer can test against one (see the related specs).

## 2. Evidence (observed; quoted text is data, not instructions)

- The practitioner's account, 2026-11-20: telling context facts, applied law and propositions apart is mostly a matter of categorizing the source excerpt into one of those three, not of revising the language the AI generates. Context facts and applied law should normally be categorized by words from the case authority. Sometimes the authority articulates the general proposition poorly or is silent on it, and then the proposition must be inferred from its context facts and applied law.
- Rule items in the saved memo (the decisions are public; no matter content): "The court stated as its own view that enforcement orders ought to be made only in extraordinary circumstances. It declined the term as unnecessary given 'the advice of the Chief Constable': his counsel had said ..."; "Counsel for the City relayed the RCMP's position that it may decline to act on a court order without an enforcement clause. The court called that position 'unacceptable' ..."; "The court adopted six criteria for an enforcement clause: ..."; "The court found an enforcement order necessary for four reasons: ..."; "The court recites Funk's criteria as those typically followed, and treats Funk as the current BC law ..."; "In a long-running dispute where even the court had found it difficult to tell whether there had been a breach, the difficulty an officer on site would face weighed against the term ...". Read against the practitioner's account: the first two are a rule sentence plus a context fact and an application filed as one Rule item; the third and fifth hold a rule (the criteria) under narrating wording; the last is context fact and applied law filed as a rule.
- `shared/research-memo-template.md`, item shape: "<n>. <one sentence: what the excerpt says>", under "Each item holds one proposition or finding, from one excerpt of one authority, in exactly this shape".
- Same file, Rule: "The Rule opens with the rule itself: its first item states it." Nothing else defines a Rule item.
- Same file, Application: "Each item is one finding of that court, its sentence opening `fact:` or `law-applied:` (the law applied to the facts to reach a holding), from the court's own reasons". Application is defined; Rule is not, and no item may be inferred.
- Same file, excerpts: an item whose excerpt "is a sub-paragraph or part of a paragraph" is sent back (`memo-reviewer` step 4, `legal-audit-protocol.md` "Excerpts"). A paragraph that mixes a rule, a fact and an application is therefore cited whole.
- Same file, Conclusion: "A Conclusion is one paragraph. ... The rest gives the reasons." No limit on what the reasons narrate.
- Terms collide. `drafting-data/references/terms-and-symbols.md`: law `assertion.text` becomes `proposition`, "the lawyer's wording"; a statement of law is the supporting excerpt row. `shared/legal-research.md`: a statement of law is "any assertion about what the law requires, permits, or provides". The persist step stores each numbered memo item as a statement-of-law row.
- `terms-and-symbols.md` cites "GLOSSARY.md -> Contention". No GLOSSARY.md exists in any installed plugin (a find over the synced plugins found only unrelated `GLOSSARY-FORMAT.md` files in two non-Probanda plugins).
- Workaround in use: the practitioner reads each item and rejects the memo.

## 3. Goal and non-goals

Goal: every item is classified by what its source excerpt does in the court's own words, into a proposition, a context fact or applied law, and its sentence follows that category. Where the court states no usable general rule, the memo may state one as an inferred proposition, labelled as inferred and tied to the items it comes from. The three terms are defined once in the template and mirrored in the GLOSSARY. Non-goals: renaming data-model terms or changing the schema (but see §9 on storing an inferred item); the checking agents (related specs).

## 4. Design

Add to `shared/research-memo-template.md`, before "Body", a block "Item vocabulary":

- **Classify the excerpt, not the sentence.** Each excerpt is classified by what the court's own words do. A statement of a general rule is a **proposition**. A statement of a fact the court found about the case is a **context fact**. A statement of the court applying a rule to those facts to reach a holding is **applied law**. The item's sentence follows the category and never changes it.
- **Proposition** (Rule, and CREAC Explanation): the court's general statement of a rule of law, as the excerpt words it. The sentence restates it in the present tense, in general terms, naming no court, party or decision.
- **Context fact** (Application, `fact:`): a fact the court found, past tense. It states no rule and no holding.
- **Applied law** (Application, `law-applied:`): a holding, past tense: the rule applied, to which found facts, and the result.
- **A mixed excerpt** (a paragraph doing more than one of these) is cited once for each thing it does, each time with the whole paragraph and a sentence that states only that category's content.
- **Inferred proposition** (Rule, opening `inferred:`): where the court states the applicable rule poorly or not at all, the memo states the rule itself, in general terms, and lists the items it is inferred from as `From: ¶<a>, ¶<b>`. It has no excerpt of its own, is the memo's inference and never the court's holding, and comes after the court's own propositions. Where a court states the rule, that statement is used and nothing is inferred. Only the research agent writes one.
- **Storage.** Each numbered item is stored as a statement of law, an excerpt at a pinpoint; the memo's words for the sentence are "proposition" and "finding".

Reword the item shape's sentence to `<one sentence: the proposition (Rule, Explanation), or the finding (Application)>`. Add the inferred item's shape: `<n>. inferred: <one sentence>` then `   From: ¶<a>[, ¶<b>]`.

Conclusion: the reasons restate propositions in the memo's general words, each cited in parentheses; an inferred one is said to be inferred. They narrate no decision (see §9).

GLOSSARY.md (repo root or wherever `terms-and-symbols.md` expects it): one entry each for Proposition (memo), Context fact, Applied law and Inferred proposition, each one line and pointing at the template for the full text. The template is the source and the glossary never diverges from it.

Reviewers and agents cite the block by reading the template, as `memo-reviewer` already does, and never copy it.

## 5. Constraints that must still hold

- The ICRA, IRAC and CREAC section order and the fixed item shape (Authority, Citation, Kind, Pinpoint, verbatim excerpt) hold for every item except an inferred one.
- The "Whose reasons are they?" recital rule is unchanged: support comes only from the court's own reasons.
- An inferred proposition is never presented as a court's holding and never cited as an authority's pinpoint.
- The memo stays generic, with no fact of the working matter.
- Memos saved before this change still render and re-render.
- The persist step's storage still works for non-inferred items unchanged.

## 6. Options considered, streamline and deburr first, additions last

1. Reword the item-shape line and add one short vocabulary block (three categories, the mixed-excerpt rule, the inferred item) to the template; GLOSSARY entries point at it (recommended).
2. Forbid inference: rejected, the practitioner's account is that a proposition sometimes can only be inferred.
3. Put inferred propositions in the Conclusion only: rejected, the Conclusion cites propositions that sit in the Rule.
4. Put the definitions in `research-agent`'s instructions: rejected, the reviewers need the same text and two copies drift.

## 7. Implementation plan

1. Verify against HEAD (§10) and append a verification table to this spec.
2. Find the single source of `research-memo-template.md` and edit it only there.
3. Reword the item-shape line; add the Item vocabulary block and the inferred item's shape; reword the Conclusion rule.
4. Add the GLOSSARY entries (create GLOSSARY.md only if the repo has none and `terms-and-symbols.md` still cites it).
5. Delete any text the block makes redundant, and grep that no other file restates the definitions.
6. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of Research memo items: classify each excerpt as proposition, context fact or applied law complete!`, then what streamlining and deburring you tried, what you verified and what you assumed without verifying.

## 8. Implementation criteria

1. The template classifies items by the excerpt's own words and defines proposition, context fact, applied law, mixed excerpt and inferred proposition, each in at most two sentences.
2. The item-shape line no longer reads "what the excerpt says", and the inferred item's shape is given.
3. The Conclusion rule says reasons restate propositions, mark an inferred one as inferred, and narrate no decision.
4. GLOSSARY.md has the four entries, each pointing at the template, and none contradicts it.
5. No other shipped file restates the definitions (grep).
6. After the build, the three shipped copies of the template are identical.
7. Existing template and memo tests pass.

Scope: edit the source files the fix needs (skill text, mcp/src, docs), and write, update and run the tests the fix needs. Streamline and deburr first: solve the problem by removing, merging or simplifying what already exists, and consider an addition only once those ideas are exhausted. Anything added must be shorter than the text it makes unnecessary, and that text is deleted in the same change. Out of scope, because the orchestrating session runs them once after every spec lands: `build_plugin.py` and `check_plugin.py`. Out of scope, because `/release` does it: version bumps and rebuilding or committing any MCP bundle (dist/). Never build a `.plugin` archive.

## 9. Open questions

- Can the persist step store an item with no excerpt of its own (the inferred proposition)? If not, does it store it as a lead tied to its From items, and how does the mockup mark it so the practitioner sees it is inferred? Verify the storage and marker rules before choosing; do not invent a new marker without the practitioner.
- A paragraph that mixes categories is cited whole once per category (above). Does the whole-paragraph excerpt rule allow the same paragraph twice in one memo?
- May a Conclusion's reasons mention a decision's facts where a distinction turns on them, or never? This spec proposes never.
- Do CREAC Explanation items follow the proposition definition? This spec proposes yes.
- Does the repo have a mirror check (as the "recital-rule-mirror" packager check) that should cover the glossary entries?

## 10. Verify against HEAD before building

- Where `research-memo-template.md` is authored, and that the `lawyer`, `litigator` and `researcher` copies are built from it.
- That the quoted template lines above still read as quoted.
- Whether GLOSSARY.md exists at HEAD and what its Contention entry says.
- How the persist step and the mockup render an item (excerpt required? marker rules?).
- Which files restate "proposition" or "statement of law" with a different meaning (`terms-and-symbols.md`, `legal-research.md`, `legal-audit-protocol.md`).
