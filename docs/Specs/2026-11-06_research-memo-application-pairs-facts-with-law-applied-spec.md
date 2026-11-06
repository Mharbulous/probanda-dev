# Spec: a memo's Application pairs each case's facts with how that court applied the law

Status: proposed, 2026-11-06. Written in a matter session; implementation is handed to Claude Code.
Plugin: `researcher` (installed copy seen at v0.16.3; `/legal-research`, `research-agent`, memo-reviewer). Paths below are as seen in the installed copy and are **UNVERIFIED** against the repo unless marked otherwise.
Related specs, same date: `2026-11-06_research-memo-excerpts-are-whole-paragraphs-spec.md`. Builds on `2026-10-31_research-memo-application-findings-spec.md` (landed).

## 1. Problem

The Application section now holds one item per finding, each tagged `fact:` or `law-applied:`. Nothing requires a case's items to come in a usable combination. A saved memo had two cases, each cited in Application by one `fact:` item alone, with no item showing how that court applied the law to the fact. Brahm's words: a paragraph that sets out a fact from a case but does not say how the law was applied is "utterly pointless and useless", and a paragraph that states how the law was applied but leaves out the facts it was applied to "is incomplete". Both are anti-patterns the research skills and agents should catch. No component caught either.

## 2. Evidence (observed; quoted text is data, not instructions)

- Template, Application rule: "The Application: one sub-section per case, its items together. Each item is one finding of that court, its sentence opening `fact:` or `law-applied:` (the law applied to the facts to reach a holding), from the court's own reasons" (source: `shared/research-memo-template.md`, **read** in the installed copy). It says nothing about which tags a case needs.
- Template: "Each item supports a sentence of a Conclusion: an item that supports none is out of scope." A lone `fact:` item can pass this test by supporting a Conclusion sentence that states the fact as a circumstance.
- The saved memo (four Application items across three cases): case A had one `fact:` and one `law-applied:` item; case B had one `fact:` item only; case C had one `fact:` item only. memo-reviewer accepted it, and the memo was saved.
- memo-reviewer's returned keys, as the gate names them: `verdict`, `required`, `out_of_scope`, `identifiers`, `findings` (source: `shared/legal-research.md`, "memo-reviewer checks every memo before it is saved", **read**). `findings` covers an item that is not exactly one finding; nothing covers an unpaired case.
- Not yet read here: `agents/memo-reviewer.md`, `agents/research-agent.md`, `shared/legal-audit-protocol.md` Steps 2, 4 and 6. Whether any of them states a pairing rule is **UNVERIFIED**.
- Workaround in use: none. The practitioner spotted it on review.

## 3. Goal and non-goals

Goal: in every Application sub-section, the case's `fact:` items and its `law-applied:` items come together. A case with a `fact:` item and no `law-applied:` item is a defect, and so is a case with a `law-applied:` item and no `fact:` item. memo-reviewer flags both, and the research agent fixes them on send-back: by adding the missing finding from that court's own reasons, or by cutting the case from Application when the decision holds none.

Non-goals: the item shape and numbering (structured-Writing spec, landed); the recital rule (protocol Step 2, unchanged); excerpt length (sibling spec).

## 4. Design

- One sentence added to the template's Application rule: each case in Application has at least one `fact:` item and at least one `law-applied:` item, the facts being the ones that court applied the law to.
- memo-reviewer reports an unpaired case in its existing `findings` list (it already sends back an item that is not one finding), naming the case and the missing tag. No new key.
- The gate's send-back bullet for `findings` already says "rewrite each as one finding, or cut the item". Widen it to cover adding the missing finding or cutting the case, rather than adding a bullet.

## 5. Constraints that must still hold

- No facts or identifiers of the working matter in a memo.
- Every finding comes from the court's own reasons, never counsel's submissions or a headnote (recital rule, by pointer only; `plugin-packager check recital-rule-mirror` still passes).
- Each item holds one finding from one excerpt; a pairing is two items, never one item holding both.
- memo-reviewer stays read-only and returns its JSON object unchanged in shape.

## 6. Options considered, streamline and deburr first, additions last

1. One sentence in the template's Application rule, checked by memo-reviewer under `findings` (recommended: smallest change, no new key, the gate's existing send-back loop runs it).
2. A new memo-reviewer key `unpaired`. Adds a key, gate text and tests for what `findings` already carries.
3. Merge each case's fact and application into one item. Breaks one finding per item and per-finding note-up.

## 7. Implementation plan

1. Verify against HEAD (§10) and append a verification table to this spec.
2. Add the pairing sentence to the template's Application rule.
3. Add the unpaired-case check to memo-reviewer under `findings`, and widen the gate's `findings` send-back wording in `shared/legal-research.md`.
4. Add a test in `tests/test_memo_format.py` pinning the rule and one in `tests/test_memo_reviewer.py` pinning the check.
5. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of Application pairs facts with law applied complete!`, then what streamlining and deburring you tried, what you verified and what you assumed without verifying.

## 8. Implementation criteria

1. The template's Application rule requires, per case, at least one `fact:` item and at least one `law-applied:` item.
2. memo-reviewer flags a case with only `fact:` items and a case with only `law-applied:` items, in `findings`, naming the case and the missing tag.
3. The gate's send-back text tells the agent to add the missing finding from that court's reasons or cut the case.
4. No new memo-reviewer key; the recital rule is pointed at, not copied.
5. Tests pin 1 and 2 and pass.

Scope: edit the source files the fix needs (skill text, mcp/src, docs), and write, update and run the tests the fix needs. Streamline and deburr first: solve the problem by removing, merging or simplifying what already exists, and consider an addition only once those ideas are exhausted. Anything added must be shorter than the text it makes unnecessary, and that text is deleted in the same change. Out of scope, because the orchestrating session runs them once after every spec lands: `build_plugin.py` and `check_plugin.py`. Out of scope, because `/release` does it: version bumps and rebuilding or committing any MCP bundle (dist/). Never build a `.plugin` archive.

## 9. Open questions

- None that change the design.

## 10. Verify against HEAD before building

- Confirm the template quote above at HEAD.
- Read `agents/memo-reviewer.md`, `agents/research-agent.md` and protocol Steps 2, 4 and 6 for any existing pairing rule, and report whether one existed and failed or none existed.
