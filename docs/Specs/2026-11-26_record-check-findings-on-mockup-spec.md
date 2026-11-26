# Spec: Show what a record check found on the factum mockup

Status: proposed, 2026-11-26. Written by the orchestrating session for the 2026-11-25 factum specs, from Brahm's request on 2026-11-26.
Plugin: `lawyer` (renderer, symbol table) and `litigator` (`/draft`, `source-tracer`, drafting-data docs). Paths are verified against HEAD on 2026-11-26 unless marked **UNVERIFIED**.
Related specs: `2026-11-25_factum-fact-check-sworn-text-and-adverse-evidence-spec.md` (its §9 Q1 is moved here), `2026-11-25_factum-facts-no-unsupported-counter-version-spec.md`, `2026-11-25_factum-part1-duplicate-facts-spec.md`.

---

## 1. Problem

`litigator:source-tracer`'s `facts_position` review now checks every Part 1 assertion of a BCCA respondent's factum against the record on appeal: the sworn text behind an exhibit, contradicting affidavits, and adverse evidence (commit `f9d42d09`). Its findings come back to `/draft` and are listed beside the mockup in that turn. Nothing stores them, so they are gone the next turn, and the mockup never shows which fact the record contradicts, overstates, disputes or does not touch. Counsel re-reads the chat or re-runs the check to find out.

Brahm asked for one mockup marker per kind of finding, to replace the 🧲 that the fact-check spec floated:
- 🤥 (Pinocchio) for a mis-statement.
- ⚔️ (crossed swords) where the record holds conflicting evidence.
- A glyph for an exaggeration. Suggested: 🎈.
- A glyph for a statement with no evidence either way. Suggested: 🕳️.

## 2. Evidence (verified at HEAD, 2026-11-26)

- `source/lawyer/mcp/src/submission/forms/symbol-table.ts` is the single list of mockup glyphs. **🤥 is taken**: `glyph: "🤥", name: "impeachment", group: "hold"`, a statement held for impeachment (`purpose='impeachment'`).
- ⚔️, 🎈 and 🕳️ appear nowhere under `source/`. Nor do 🫥 and 🎣.
- These existing glyphs are near the new meanings and must stay distinct from them:
  - 👃 "asserted, but doubted", work "check it". This is the state before a check.
  - 🧾 "factual basis needed": our contention rests on no stated fact.
  - 🤷 "no knowledge": a pleading response.
  - 🚩 "adverse": a fact harmful to our position, held for a disclosure and rebuttal decision.
- drafting-data `facts` has columns `id, proceeding_id, postulate, court_record, court_record_pinpoint, adverse, procedural_on` (`source/skills/drafting-data/references/schema.sql` line 82). It has no column that can hold a check finding. The facts-position prose (`filing_prose`, `slot='facts_position'`) has no column for one either.
- `source/skills/drafting-data/CLAUDE.md` says the symbol-table files change only with Brahm's express approval, after a review by the most capable model (as reported by the duplicate-facts agent, 2026-11-26; **UNVERIFIED** wording).
- CLAUDE.md "Never commit" forbids adding schema DDL. COMMANDMENTS.md's Exception says no revision may make the development plugin rely on the legacy-store exception more than it already does, and drafting-data is a legacy store. `check_publishable.py` counts any edit to `schema.sql` or `migrations.sql` as a new problem, which needs a person's ruling in `source/exception-rulings.json`.

## 3. Goal and non-goals

Goal: after the record check runs, each checked Part 1 assertion shows on the mockup, and never on the filed face, which of four findings applies, with the pinpoint that supports it. The finding stays until the assertion or its source changes. The four findings:

| Finding | Meaning | Proposed glyph |
|---|---|---|
| Mis-statement | the record says otherwise | §9 Q1 (🤥 is taken) |
| Conflict | the record holds evidence both ways | ⚔️ |
| Exaggeration | true at its core, but stated beyond what the record shows | 🎈 |
| No evidence | the record neither supports nor contradicts it | 🕳️ |

A verified assertion shows no glyph. A new glyph replaces 👃 on the same line, because 👃 asks for the check and the finding is its result.

Non-goals:
- How the check is done. That is the fact-check spec, already landed.
- The duplicate marker. That is the duplicate-facts spec.
- Other kinds' fact parts, unless §9 Q4 is answered yes.

## 4. Design

1. **Glyphs.** Add four rows to `symbol-table.ts` in the `work` group: each with its meaning, the work ("revise or source it, or keep it on counsel's word"), the actor (the drafter) and its condition. Update the legend files that mirror the table (`work-markers.md`, `terms-and-symbols.md`) through whatever generates or tests them.
2. **Storage.** A finding must be stored for the renderer to print it. The options are in §6, and the storage choice is §9 Q2.
3. **Write path.** `/draft` records each finding the `facts_position` review returns, through `/drafting-data`, before it presents the mockup. It clears a finding when the assertion's text or source changes.
4. **Render.** `render-bcca-factum.ts` prints the glyph after the assertion with a mockup-only comment carrying the pinpoint, for example `7. The respondents were not parties to the schedule. 🎈 <!-- AB Vol. 2, p. 140 -->`. `emit-bcca-factum.ts` prints nothing new.
5. **Open-items count.** Each glyph counts as an open item until counsel revises the assertion or keeps it.

## 5. Constraints that must still hold

- The checker stays read-only and states no law. `/draft` records the findings, never the agent.
- Mockup-only lines never reach the filed face.
- Counsel's dictated text is never rewritten. A glyph only flags.
- One meaning per glyph. 🤥 keeps "impeachment" unless Brahm moves it (§9 Q1).

## 6. Options considered, streamline and deburr first, additions last

1. **Reuse `statements_of_fact.doubt` (free text) for the finding.** No DDL. But most Part 1 facts have no statement row, and a statement row needs a witness. Rejected in the fact-check spec for the same reason.
2. **A finding stored in a prose comment on the facts-position paragraph, e.g. `<!-- check: 🎈 AB Vol. 2, p. 140 -->`.** No DDL. It covers only the prose, not the other Part 1 facts, which are rows with no free-text column.
3. **One new nullable column on `facts`, e.g. `record_check TEXT` holding the finding and its pinpoint, plus the same in a `filing_prose` comment for the position paragraphs** (recommended, subject to Brahm's ruling). This is the smallest change that covers every Part 1 assertion. It is DDL on a legacy store, so it needs a ruling and Brahm's judgement on the Exception.
4. **A new `record_check_findings` table keyed to the fact or the prose paragraph.** It is cleaner to query, but it adds a table to a legacy store, which leans on the Exception more than option 3 does.
5. **Do nothing.** The findings stay listed beside the mockup each turn, as now.

## 7. Implementation plan

1. Do not start until Brahm has answered §9 Q1 and Q2.
2. Verify against HEAD (§10) and append a verification table to this spec. Commit that alone.
3. Get the symbol-table review from the most capable model, as `drafting-data/CLAUDE.md` requires, then add the four glyph rows (§4.1).
4. If Brahm chose option 3 or 4: write the migration hop and the schema change, and add the ruling entry only if Brahm writes it himself. Then wire the write path (§4.3).
5. Render (§4.4) and count (§4.5). Add a `bcca-mockup-messages.db.test.mjs` case with invented generic text covering each glyph, with and without 👃, and showing none on the filed face.
6. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of Show what a record check found on the factum mockup complete!`, then what streamlining and deburring you tried, what you verified and what you assumed without verifying.

## 8. Implementation criteria

1. Each of the four findings has one glyph, used for nothing else, with a row in `symbol-table.ts`.
2. A mockup render of a Part 1 assertion with each finding shows its glyph and pinpoint, and 👃 is gone from that line.
3. The filed face shows none of them.
4. A finding survives to the next turn and clears when the assertion or its source changes.
5. `python scripts/check_publishable.py --new-since origin/main` reports no new problem beyond any that Brahm has ruled on.

Scope: edit the source files the fix needs (`symbol-table.ts` and its legend files, the factum renderer, the `/draft` and drafting-data skill text), and write, update and run the tests the fix needs. Streamline and deburr first. Out of scope, because the orchestrating session runs them once: `build_plugin.py` and `check_plugin.py`. Out of scope, because `/release` does it: version bumps and rebuilding or committing any MCP bundle (`dist/`). Never build a `.plugin` archive. Only a person writes to `source/exception-rulings.json`.

## 9. Open questions

1. **Mis-statement glyph.** 🤥 means "impeachment". Either 🤥 moves to mis-statement and impeachment takes another glyph, or mis-statement takes another glyph, such as 🙃 or 🪤. Brahm decides.
2. **Storage.** Option 3 (one column plus prose comments, recommended), option 4 (new table) or option 5 (do nothing). Options 3 and 4 need Brahm's ruling and his judgement on the COMMANDMENTS Exception.
3. **Conflict versus adverse.** Should ⚔️ stand alone, or should the existing 🚩 "adverse" carry "the record cuts the other way" instead? Default: ⚔️ stands alone, because 🚩 is a disclosure hold on our own harmful fact, not a finding about one assertion.
4. **Other kinds.** Do the same findings belong on the Application Response's facts and the BCCA stay response's? Default: no, until this ships for the factum.

## 10. Verify against HEAD before building

- The `symbol-table.ts` rows quoted in §2, and whether ⚔️, 🎈, 🕳️ and the chosen mis-statement glyph are still unused.
- The `source-tracer` `facts_position` output fields (`sworn_text`, `adverse`) from `f9d42d09`, and whether they already separate the four findings or need a `finding` field.
- What generates or tests the legend files against `symbol-table.ts`.
- The current drafting-data schema version and the last migration hop.
