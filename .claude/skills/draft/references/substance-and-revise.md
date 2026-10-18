Read when: an assigned job writes substance or sends a research question (SKILL.md section 9), an item is elicited on a kind whose type file has a Deployment section (section 10), or the practitioner asks for a change (section 12).
Assumes SKILL.md is loaded. Rules are not restated here.

## Section 9: Substance: where content comes from

| Source | Rule |
|---|---|
| The practitioner | Anything only they know: relief sought, argument, witness evidence, what to hold in reserve, tactics, priority. |
| `/matter-data` and the practice matter lookup | Offered as a starting point, confirmed before writing. A convenience, not an integration: nothing syncs back while the Writing is live. Say so once if asked, never as a recurring disclaimer. Retirement is the one designed flow-back. Counsel of record and addresses for service are the exception: case data owns them, session entry compares them live, and a correction to them is written to case data through `/matter-data` first (section 8). |
| `/legal-research` | Every statement of what the law is. Never supply legal content yourself. Leave the slot open and let its work marker render. |

Before sending a research question, ask the gatekeeper whether the proceeding already holds an authority the practitioner reviewed and rejected on the same or a close proposition, and pass it as a named exclusion rather than re-researching it. The same applies to a rejected submission before drafting or proposing a new one. Full procedure: `references/authorities.md`.

**A contention is an application paragraph.** A contention the session proposes connects, in prose, the facts the submission rests on to the propositions it requires. It is never a bare conclusion and never a restatement of the facts alone or the law alone. A contention the practitioner words is recorded as given.

One legal point supporting several submissions renders once in full and thereafter as a cross-reference ("As set out in paragraph N, above"). Do not read that as missing data.

**Missing-facts interview.** For a gap only the practitioner can fill (not a lookup, not law, not tactics): name the gap and its cost. A candidate the record holds is proposed with its source; a gap the record cannot fill is asked empty-handed. Per item, in this order: what they or the client know directly; other reachable, willing witnesses; documents, who holds them, whether requested; whether it is still current; what the other side could say and anything cutting the other way (never skip this item); anything else. Record verbatim. Only the practitioner closes the round, by saying there is nothing further, never infer it. Where a gap stays unfilled, leave the slot open and ask whether to reframe, drop, or proceed.

**Writing.** Every write goes through the gatekeeper's write tool, `drafting_data__execute`, composed against the live checklist at that moment. Re-query the new material afterwards through its read tool, `drafting_data__query` (never used to open a session). On any non-success result, follow the gatekeeper's routing rule for that operation before any further write or retry. A non-success result does not prove the write did not land, never re-run blind.

Offer a closed template set as a plain-language menu of all choices, never as one bundle.

**Dead-end decision.** Exhausted research on a basis slot is the one thing that stops drafting and asks. Procedure: `references/authorities.md`.

## Section 10: Deployment

Where the type file has a Deployment section, follow it.

**Legacy loose-thread marker:** see `references/legacy.md`.

## Section 12: Revise

Re-enter at section 9: elicit the change, write it, re-render. No revision mode, no different vocabulary. A rewording of one reviewed paragraph, or a swap or move of facts on a Writing, follows `revise-on-the-fly.md`. Every other revision re-enters at section 9 as written.

The practitioner speaks in the numbers printed on the mockup they are looking at. Reorder, insert and remove are ordinary revision requests; renumbering everything downstream is the machinery's job, never something the practitioner tracks or is asked about.

Once the overstatement review has run on the Writing, a revision that adds or changes an assertion reruns the overstatement review on that assertion with the re-render, one decision form per new flagged finding, each left undecided written to the Job Board, never a report or a card (`references/overstatement.md`).

A revision that falsifies a fact a letter's title names offers a new title in one line. Once confirmed, retitle through `/drafting-data`, then run section 11's rename and the nightly-list retitle update (`references/nightly-launch.md`, Opt-in, withdrawal and retitle), and render again.

A revision's Word or PDF copy is presented as current, with its superseded copies offered to TRASH (`shared/workspace-output-rule.md`).

A stamped entered order coming back is an ordinary substance write, then a re-render. A change targeting the renderer's own template text is not a revision, say so, because that is a plugin change. Review has no exit gate: it ends when the practitioner asks for the next change, in the same plain words that started the draft.
