# Spec: Respond to an unsupported fact by pointing to the gap, and claim an absence only after a full search

Status: proposed, 2026-11-25. Written in a matter session; implementation is handed to Claude Code.
Plugin: `litigator` (installed copy seen at v0.28.2). Paths below are as seen in the installed copy and are **UNVERIFIED** against the repo unless marked otherwise.
Related specs, same date: `2026-11-25_factum-fact-check-sworn-text-and-adverse-evidence-spec.md`, `2026-11-25_appeal-record-is-the-appeal-books-spec.md`, `2026-11-25_factum-part1-duplicate-facts-spec.md`, `2026-11-25_factum-issues-on-appeal-own-statement-spec.md`

---

## 1. Problem

In a BCCA respondent's factum, Part 1 answered the appellants' unsupported factual assertion (that the respondents executed an agreement) with the respondents' own counter-account of the document: who its parties were, who signed, who was not a party, how persons were described in it. That counter-account had to meet the same standard of proof the appellants' assertion failed, and it did not: three of its claims asserted the non-existence of evidence ("Nothing in the record ... shows", "The only copy in the record", "refers to them only as the 'Consultants'") after checking one exhibit. A record check found two of the three wrong or overstated (other copies of the document exist in the record as a blank schedule form; one person is also named elsewhere in the same document). Brahm: "it is dangerous and unwise to respond to facts claimed without supporting evidence with an alternative version of facts that is just as unsupported." Pointing out that no evidence supports the other side's fact "is good"; going further requires certainty, "especially when claiming the non-existence of evidence."

## 2. Evidence (observed; quoted text is data, not instructions)

- `draft/references/CAN/BC/BCCA/Documents/respondent-factum.md`, Part 1 bullet: "Part 1, the respondents' position on the appellants' statement of facts. Agreement is a position (\"The respondents agree with the appellants' statement of facts, except...\"). Then any other facts the respondents consider relevant, each with its source". No rule on how to answer a disputed fact, and no rule on asserting absence.
- `drafting-data/references/filing-checklists.md` §12 Part 1: the position is `filing_prose` `slot='facts_position'`, free prose with no source requirement; the other facts carry `court_record` + `court_record_pinpoint`.
- Agent `litigator:source-tracer` description: checks "every factual assertion in one outgoing letter, email, memo or reply" — letters, emails, memos and replies; a filing's facts-position prose is not named.
- Outcome: the position paragraph made 5 factual claims; an adversarial record check rated 2 accurate, 2 overstated, 1 inaccurate (in a related Part 1 paragraph). Cost: one practitioner review turn, one investigation agent (~200k tokens, 54 tool calls), and a factum that would have been filed with an overstatement on the record.

## 3. Goal and non-goals

Goal: when the other side states a fact without evidence, the drafted response says so, pinned to what the record lacks, and adds a counter-fact only when that counter-fact is itself sourced and checked. Any sentence asserting that evidence does not exist ("nothing in the record", "the only", "no ... ", "only as") is written only after an exhaustive search of the record and carries what was searched. Non-goals: which record counts on appeal (sibling spec), checking sworn text and adverse evidence for a positive fact (sibling spec).

## 4. Design

1. A rule in the respondent-factum type file's Part 1 bullet (and, if `/draft` has a general facts-drafting rule, there instead, cited from the type file): answering a disputed fact starts from "no evidence in the record supports ..." with the record searched; a counter-account is added only when each of its facts is sourced to the record and passes the sibling spec's checks.
2. An absence claim is a fact like any other: it needs a source, and its source is the search. The rule names the absence words to watch for and requires an exhaustive search of every book of the record before such a sentence is written; otherwise reword to what was actually checked (e.g. "the only executed copy" rather than "the only copy").
3. The facts-position prose is brought under the source-trace review the agent already performs for letters, so each claim in it is checked before the mockup is presented. Whether that is a new mode of `litigator:source-tracer` or an extension of its reliance mode is §9 Q1.

## 5. Constraints that must still hold

- The facts-position prose stays practitioner-owned text; the rule constrains what the session drafts, not what the practitioner dictates.
- No statement of law enters Part 1.
- Deadline isolation and the other `/draft` bans unchanged.

## 6. Options considered, streamline and deburr first, additions last

1. Replace the type file's Part 1 bullet with one that states the respond-to-the-gap rule and the absence rule, and point the existing source-trace review at the facts-position prose (recommended): no new agent; the bullet grows by about two sentences.
2. A new factum-facts checker agent: duplicates `source-tracer`.
3. Mockup marker only (flag absence words): catches the words, not the missing search.

## 7. Implementation plan

1. Verify against HEAD (§10) and append a verification table to this spec.
2. Rewrite the Part 1 bullet of the respondent-factum type file (§4.1, §4.2), deleting any wording it makes redundant.
3. Extend the source-trace review to the facts-position prose (§4.3), in the `/draft` file that orders it before a mockup is presented.
4. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of Respond to an unsupported fact by pointing to the gap, and claim an absence only after a full search complete!`, then what streamlining and deburring you tried, what you verified and what you assumed without verifying.

## 8. Implementation criteria

1. The Part 1 rule says a disputed, unsupported fact is answered by pointing to the absence of evidence, and that a counter-account is added only when each of its facts is sourced.
2. The rule requires an exhaustive search of the whole record before any sentence asserting the absence of evidence, and lists the trigger words.
3. The facts-position prose is reviewed claim by claim against the record before the mockup is presented.
4. No other file restates these rules instead of citing them.

Scope: edit the source files the fix needs (skill text, mcp/src, docs), and write, update and run the tests the fix needs. Streamline and deburr first: solve the problem by removing, merging or simplifying what already exists, and consider an addition only once those ideas are exhausted. Anything added must be shorter than the text it makes unnecessary, and that text is deleted in the same change. Out of scope, because the orchestrating session runs them once after every spec lands: `build_plugin.py` and `check_plugin.py`. Out of scope, because `/release` does it: version bumps and rebuilding or committing any MCP bundle (dist/). Never build a `.plugin` archive.

## 9. Open questions

1. New `source-tracer` mode for filing prose, or extend its reliance mode? Decide from the source; ask Brahm only if both change behaviour elsewhere.
2. Does the same rule belong in other kinds' fact parts (Application Response Part 4, BCCA stay response)? Default: put it where all fact-answering drafting can cite it.

## 10. Verify against HEAD before building

- The Part 1 bullet and §12 Part 1 read as quoted in §2.
- Which `/draft` file orders the source-trace review, and whether it already reaches filing prose.
- Whether a general facts-drafting rule already exists in `/draft` that should host §4.1–4.2.
