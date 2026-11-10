Read when: `/lawyer:suggestion` reaches section 5 (Refine).
Assumes SKILL.md is loaded. Its rules are not restated here.

# Refining a suggestion

## The goal

A maintainer reads the suggestion later, with no way to ask the practitioner anything. Refinement answers now the questions they would otherwise ask:

1. **Fidelity.** The suggestion says what the practitioner actually wants, not Probanda's reading of it.
2. **Done-test.** It says what "fixed" looks like, in a form a maintainer can check alone.
3. **Constraints.** It says what the practitioner would reject, and why.
4. **Separate, general items.** Each change can be accepted or declined on its own, and helps other practitioners too. A change that suits only this person belongs in their preference (SKILL.md section 3), not in the suggestion.

## The method: show, then let them react

People recognize what is wrong far better than they can describe what is right. So Probanda does the drafting, and the practitioner confirms, corrects, picks or rejects. Ask closed questions only: "Is this right?", "Which of these?". Never ask an open question such as "What would you want?".

- **Fidelity.** Show the drafted items in plain words, as what would change for them. Their corrections expose the misunderstandings.
- **Done-test.** Show what "done" would look like (below) and ask whether that is it. On Path A, what the practitioner accepted in the session is the done-test.
- **Constraints.** Show two or three variants side by side that differ in the dimension that matters. The reason the practitioner gives for rejecting a variant becomes a constraint.
- **Separate items.** Probanda splits and generalizes the changes itself, then shows the list. The practitioner confirms it, or moves an item to "just for me", which makes it a preference.

Behaviour the session already proved is stronger evidence than anything asked for. Use it first.

## How to show "done", by type of pain

Each way of showing "done" is a before and after of what the practitioner experiences, in that experience's own medium.

| Type of pain | Shown locally | Posted |
|---|---|---|
| UI (a page, a card, a layout) | For a board, only a deterministic preview of the page. A model never writes the page's HTML (`shared/html-pages.md`). Where no such preview exists, a markdown sketch of the layout. | The visual items, each marked visual on the card, and the rejection reasons as constraint lines. A mockup travels only when the practitioner asks for one on the card (SKILL.md section 6), built from placeholder text alone. |
| Output (a draft, letter, document) | A redraft beside the original | The change described generically, plus the constraints |
| Workflow, behaviour, trust, discoverability | A replay of the relevant turns as they would go once fixed | A numbered list of generic steps, drafted fresh |
| Accuracy (a wrong date, value, filing) | The worked case from the session | A test case with invented facts that keeps the logic that went wrong |
| Missing capability (Path B) | The end result the practitioner wanted | That end result, stated generically |
| Reliability (a tool fails) | The steps and the error | Steps that reproduce it, plus the expected result, with paths and names removed |
| Speed or cost | The measured time or turn count | The measurement now and the target the practitioner confirmed |

**Real content stays local.** What is shown on the practitioner's machine may use their real matter content. What is posted is drafted fresh from placeholders. It is never made by swapping names out of the transcript, because pattern screening cannot catch a client's name, a file number or an amount. Anything shown as a file goes through the file-card tool `shared/present-files.md` names. What is posted is only what the card shows, and the practitioner sees all of it there before they submit.

**Preferences hold no client content.** A preference is an instruction to a named skill, in generic terms: "Show the deadline summary before the full list". It never names the matter it came from.
