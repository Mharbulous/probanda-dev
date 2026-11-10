---
name: sweep-draft
description: List, by line number, each sentence in a plain draft file that states law with no citation and no linked research answer. States no law and writes nothing. Reached through /verify-law.
---

# Sweep a plain draft

Plain-draft mode of `/verify-law`. The front door's live-issue posture and its hard constraint
for this skill tree bind every step here.

A draft kept as a plain file, such as an email to a tribunal drafted as markdown, has no work
markers, so nothing flags a statement of law that no research stands behind. This mode is that
flag, run on request. It finds sentences. It never says whether one is right.

## When it runs

Only when the practitioner asks to sweep a draft for unsupported statements of law, or a skill
doing work they instructed asks. Never on your own initiative, and never as a step another
mode adds of its own motion.

A Writing in `/draft` is not swept here: its mockup already marks each submission with no
linked proposition with 📚. Say so in one line and stop.

## Input

One plain text draft: a `.md` or `.txt` file the practitioner names. Any other format is
declined in one line naming the format, because its text is not read reliably here. Read the
file whole with the `Read` tool, which numbers its lines.

## Steps

1. **Find each statement of law.** A sentence states law when it asserts what the law
   requires, permits or provides: a test's elements, a statute's effect, what courts have held,
   whether conduct is actionable. That is `shared/legal-research.md`'s definition, applied as
   written. Not swept: procedural mechanics and arithmetic, a quoted authority's own words
   identified as such, a party's own position attributed to them (that file's items 1 to 3), and a
   sentence framed explicitly as a hunch.
2. **Keep only the unsupported ones.** Drop a sentence that carries a citation to an authority,
   with a pinpoint, in the sentence itself or in a footnote it calls. Drop a sentence that links
   or names a saved research answer file. Every other sentence from step 1 stays. Whether a
   citation is accurate is Mode A's question or `verify-authorities`', never this mode's.
3. **Report**, in the draft's own order, one line each:
   `Line <n>: "<the sentence, word for word>"`. A sentence that runs over several lines takes
   its first line's number. With none, say in one line that the sweep found no statement of law
   standing without a citation or a linked answer.
4. **Offer, never run.** End with one line offering to put any listed sentence to
   `/legal-research`, with `Origin: <the draft's path>: "<the sentence>"`, so that the
   research return's corrections and follow-ups go on the matter's board. Each question runs
   only on the practitioner's yes, naming which lines.

## What it never does

- States no law. The report quotes the draft and adds no view on whether a sentence is right,
  wrong, overstated or arguable, and proposes no wording.
- Writes nothing: no edit to the draft, no file, no row, no captured item.
- Never ranks the sentences or suggests which to research first.
