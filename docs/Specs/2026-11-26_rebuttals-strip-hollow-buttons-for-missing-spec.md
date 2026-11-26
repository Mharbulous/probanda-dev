# Spec: the Rebuttals strip shows a hollow button for each argument that has no rebuttal

Status: proposed, 2026-11-26. Written in a matter session; implementation is handed to Claude Code.
Plugin: `lawyer` data server (matter pages) (installed copy seen at v0.33.0). Paths below are as seen in the installed copy and are **UNVERIFIED** against the repo unless marked otherwise.
Related specs, same date: `2026-11-26_rebuttal-number-without-letter-spec.md`

---

## 1. Problem

The Rebuttals tab's number strip lists only the rebuttals that exist. An argument that needs a rebuttal and has none leaves no gap, so the practitioner cannot see at a glance which arguments are unanswered. The practitioner asked for "transparent buttons to show which rebuttals are missing". An earlier design constraint (2026-11-25) already said: "An argument with no rebuttal must be easy to spot (the point is thoroughness)."

## 2. Evidence (observed; quoted text is data, not instructions)

- Screenshot of the Rebuttals tab after a render on 2026-11-26 13:55: strip "22.a 23.a ... 41.a 41.b 42.a 43.a 44.a 45.a", every button drawn the same, no placeholder for any missing number.
- Earlier constraint text: "An opposing argument with no live rebuttal still shows "rebuttal needed"" (from the earlier one-to-one /fix-this block). Where that shows today is **UNVERIFIED** (the page was not read; a session never reads it).
- Workaround in use: none; the practitioner compares the Arguments tab against the Rebuttals tab by eye.

## 3. Goal and non-goals

Goal: the strip shows one button for every argument that a rebuttal should answer, in number order; one that has a rebuttal is drawn as now, one that has none is drawn hollow (transparent fill, outline only) with its number, and clicking it opens that argument on the Arguments tab. Non-goals: changing which arguments need a rebuttal (opposing arguments; ours need none unless the rules already say otherwise).

## 4. Design

Build the strip from the arguments needing rebuttal, not from the rebuttal rows. Each slot takes the label rule of the sibling spec; an empty slot uses the bare argument number.

## 5. Constraints that must still hold

- Killed arguments get no slot; reserved ones follow the page's existing reserve display.
- Tab linking (expand an argument, switch tabs) keeps working.
- No numbers are reused or renumbered.

## 6. Options considered, streamline and deburr first, additions last

1. Drive the strip from the argument list, with a hollow style for empty slots, replacing the rebuttal-row loop. (recommended)
2. Append a separate "missing" list under the strip. Adds a second element; rejected.

## 7. Implementation plan

1. Verify against HEAD (§10) and append a verification table to this spec.
2. Rebuild the strip from the arguments needing rebuttal; add the hollow style; clicking a hollow button opens the argument.
3. Tests: a proceeding with three opposing arguments, two rebutted, renders three buttons with one hollow.
4. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of the Rebuttals strip shows a hollow button for each argument that has no rebuttal complete!`, then what streamlining and deburring you tried, what you verified and what you assumed without verifying.

## 8. Implementation criteria

1. Every argument needing a rebuttal has exactly one strip button (or one per rebuttal when it has several), in number order (test).
2. An argument with no rebuttal has a hollow button with its number (test on the generated HTML class or style).
3. The page passes its existing page checks.

Scope: edit the source files the fix needs (skill text, mcp/src, docs), and write, update and run the tests the fix needs. Streamline and deburr first: solve the problem by removing, merging or simplifying what already exists, and consider an addition only once those ideas are exhausted. Anything added must be shorter than the text it makes unnecessary, and that text is deleted in the same change. Out of scope, because the orchestrating session runs them once after every spec lands: `build_plugin.py` and `check_plugin.py`. Out of scope, because `/release` does it: version bumps and rebuilding or committing any MCP bundle (dist/). Never build a `.plugin` archive.

## 9. Open questions

1. Which arguments "need" a rebuttal: only opposing ones, or also neutral ones? Default: whatever the page's existing "rebuttal needed" rule uses.

## 10. Verify against HEAD before building

- Where the Rebuttals strip is built and from which rows.
- The existing "rebuttal needed" rule and where it shows.

### Verification against HEAD (2c72a0fa, 2026-11-26)

| Claim | At HEAD | Where |
|---|---|---|
| The strip lists only existing rebuttals | Confirmed. `section()` builds one radio and label per card in `items`, and the Rebuttals tab is called with `data.rebuttals`, so the strip holds only rebuttal rows | `source/lawyer/mcp/src/templates/view-pages/arguments.js`, `section()` and its `section("rebuttals", ...)` call |
| The rebuttal rows and their order | `data.rebuttals` is every argument with a rebuttal link: live first by number then label path, killed last by kill date. A merged board concatenates each proceeding's list | `source/lawyer/mcp/src/submission/forms/arguments-page.ts`, `argumentsFor()` `order` and `buildArgumentsData()` |
| The "rebuttal needed" rule | It exists as the "No rebuttal" tag: an opposing argument, not killed, not itself a rebuttal, with no live rebuttal. The wording "rebuttal needed" appears nowhere | `arguments-page.ts`, `card()` |
| Where it shows | As a flag tag on the argument's card, and counted in the Arguments heading ("N with no rebuttal") | `arguments-page.ts` `card()`; `arguments.js` `unanswered` count |
| Labels | An argument's only live rebuttal takes its bare number ("#24"), several take "#41.a", "#41.b" (the sibling spec, landed in 2c72a0fa). A strip label is the card label without "#" | `arguments-page.ts` `labelOf`; `arguments.js` `section()` |
| Tab linking | `sections[name].show(number)` lists every card and opens that number; `select(tab)` switches tabs. Both exist and are reused | `arguments.js` |
| Paths | The spec's "installed copy" paths map to the repo paths above; the page script and its styles are `arguments.js` and `arguments.css` beside it | `source/lawyer/mcp/src/templates/view-pages/` |

§9 Q1 is settled by this rule: a slot goes to each argument carrying the "No rebuttal" tag, so killed arguments and our own get none.
