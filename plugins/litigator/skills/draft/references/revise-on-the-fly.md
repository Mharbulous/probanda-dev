Read when: the practitioner asks to reword one of the reviewed paragraph types, or to swap or move a Writing's facts or its material to be relied on.
Assumes SKILL.md is loaded. Rules are not restated here.

# Revise one reviewed paragraph on the fly

The reviewed paragraph types are a fact, a statement of fact (evidence), a proposition of law, a statement of law, a submission, an order sought and a rhetorical paragraph. A clause or a prose slot is not revised here: it goes through section 12 as written. This route runs in any session, holding a job or not, and takes no job. It writes through `/drafting-data` alone, by `.claude/skills/drafting-data/references/paragraph-revision.md`, which holds every read and write named below.

1. **One paragraph at a time.** Split the request into one decision per fact, statement, proposition, submission, order or rhetorical paragraph, whether it spans paragraphs or names several items in one. Take the items one at a time, each through steps 2 to 6 before the next: the next item is raised only once the last is approved and written, or withdrawn. Wording changes are never approved in a batch.
2. **Foreign-scope read.** Find the row and run the foreign-scope read, both through `/drafting-data`. A hit is refused in one line naming the job as that file words it, and nothing is written. Any other refusal that file words (a statement printing its exhibit's excerpt, a stale mockup, no row or more than one) is relayed in one line, and nothing is written. A session holding a job also runs its own job's scope read (section 3, Scope), unchanged.
3. **Compose the revised paragraph.** Build it on the practitioner's direction, whether they gave wording or described the change. Fix spelling and grammar. Fill a blank from the record. A blank the record cannot fill is asked about in one line and never invented. Keep every qualifier, burden word, date, name, figure, citation, pinpoint and quotation the direction does not change. Use capitalized terms as defined in the rendered mockup's earlier paragraphs, and follow the `style` block (step 7). On a proposition or statement of law, change only what the practitioner directed, never the legal effect, because that would be a statement of law. On a rhetorical paragraph, say in one line whether the revised wording states law or fact, so the write records `states_law` and `states_fact` as `paragraph-revision.md` §1 says. Compare the result with the record. Flag a date, name, figure or citation that conflicts with it, in one plain sentence per flag.
4. **Show it.** One reply, in this order:
   - optionally, the current wording as a blockquote, never fenced;
   - each flag sentence from step 3, as plain text;
   - exactly one fenced code block, never nested inside an outer fence, holding the revised paragraph exactly as it will be saved, with no strike-through, bold or other change markup, because markdown does not render inside a code block;
   - one line asking the practitioner to reply yes to save it, or to say what to change.

   The reply holds no other fenced code block. It uses no decision form, widget or `AskUserQuestion`: the practitioner-words gate reads only a typed approval. Put the reply in the final reply text, or in `SendUserMessage` when tool calls are still pending, because text between tool calls is not shown verbatim. This is one place chat carries document text, an exception to section 3's "Chat is not the review surface". The mockup stays the review surface after the write.
5. **The answer.** A bare yes (yes, approved, ok, go ahead) approves the paragraph shown. A change request composes the paragraph afresh and shows it again (steps 3 and 4). A withdrawal writes nothing and closes the item.
6. **Write.** Write the approved paragraph by that file's one-script write, one paragraph per approval. The choice and origin are `proposed` and `practitioner` when the paragraph is, character for character, wording the practitioner typed in one turn, and otherwise `alternative` and `model`. A hook refusal is quoted verbatim and stops: no retry and no reworded text. Then re-render (section 11). The revision bump and 🧐 follow from the write.
7. **Style.** Read the `style` block from `probanda.json` through `/practice-data`. If it is absent, ask once for the spelling convention, in a data form, and write the answer back there, as counsel's review does with its `review` block.

The layout of step 4 with one flag standing, shown indented so it reads as a literal example:

    > The invoice was delivered on April 2nd 2025.

    The invoice in the record (Ex. 4) shows delivery on 2 April 2025, not 3 April.

    ```
    The invoice was delivered on 2 April 2025.
    ```

    Reply yes to save this wording, or tell me what to change.

## Reorder

A request to swap two facts on a Writing ("swap facts 3 and 4"), to swap two lines of its material to be relied on ("swap the affidavits at 2 and 3 in Part 4"), or to move one to another position ("move fact 5 to position 2") changes their order, not their wording. It runs in any session, holding a job or not, takes no job, and writes through `/drafting-data` alone, by `paragraph-revision.md` section 6 (Move) for facts and section 7 (Material move) for material.

1. **The form only.** The route moves the facts the Writing's form numbers (a Notice of Application's Part 2) and the material it lists (a Notice of Application's Part 4, an Application Response's Part 6). A request naming the Written Arguments, or a Writing whose facts sit only there, is refused in one line as `/drafting-data` words it, and nothing is written: the Written Arguments print no fact order.
2. **Locate and foreign-scope read.** Find the two facts or material lines by the positions the practitioner names and run the move's foreign-scope read, both through `/drafting-data`. A hit is refused in one line naming the job as that file words it. Any other refusal that file words (a sent or retired Writing, a position out of range, two rows sharing one place) is relayed in one line. Either way nothing is written. A session holding a job also runs its own job's scope read (section 3, Scope), unchanged.
3. **Swap.** One swap is one write, by that file's one-script swap. "Move to position K" runs as consecutive swaps of neighbours, each its own write, locating afresh before each. It stops at the first swap that writes nothing and reports the order as it then stands.
4. **Confirm and re-render.** Confirm each swap through `/drafting-data`, then re-render (section 11). Reply in one line. For facts, say the form's fact order changed and the Written Arguments are untouched. For material, say the list order changed and how exhibit numbers follow, as `paragraph-revision.md` section 7 words it for this Writing: on a VanIAC submissions package only documents first numbered in this draft renumber, and on any other Writing the swapped documents' "Ex. N" follow the new order. A swap that wrote nothing is said so, and the mockup is re-rendered. A hook refusal is quoted verbatim and stops: no retry.

A reorder runs these steps in place of the seven above: no revised paragraph composed or shown, no approval and no style read, because no wording changes. 🧐 is not re-raised: the move changes no wording counsel approved. The fact cross-references and "Ex. N" citations the mockup prints follow the new order at render time, but a number typed into wording ("see paragraph 3", "Ex. 3") is not renumbered.
