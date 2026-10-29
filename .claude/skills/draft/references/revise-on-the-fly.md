Read when: the practitioner asks to reword one of the reviewed paragraph types, to move, recast, remove, restore or kill a paragraph on a Writing, or to swap or move its material to be relied on.
Assumes SKILL.md is loaded. Rules are not restated here.

# Quick edits on the fly

A quick edit is stated and approved in one exchange: reword one reviewed paragraph, move a paragraph, recast it into another Part, take it off a document (remove), put a removed one back (restore), or kill a submission or proposition. The reviewed paragraph types are a fact, a statement of fact (evidence), a proposition of law, a statement of law, a submission, an order sought and a rhetorical paragraph. A clause or a prose slot is not edited here: it goes through section 12 as written. Work an agent would spend minutes or hours on (research, drafting a section, a review pass) stays a job.

This route runs in any session, holding a job or not, and takes no job. It writes only through two tools, `drafting_forms__preview_edit` and `drafting_forms__apply_edit` (`/drafting-data`'s `paragraph-revision.md` section 8). The session composes no SQL and runs no `drafting_data__execute` on this route. It names each paragraph by its document, Part and printed number exactly as the practitioner saw them, and the tools resolve, check, write and audit. A session holding a job also runs its own job's scope read (section 3, Scope), unchanged.

1. **The revision seen.** Every presenting render returns the Writing's `revision`. That number, for the mockup last presented for that document, is the session's `seen_revision`. A render that was not presented to the practitioner does not change it. `drafting_forms__apply_edit`'s own render is presented, so its `revision` becomes the new `seen_revision`.
2. **Split the request.** Turn the instruction into ops. Each op names its target, and a move or recast its anchor, as `{document, part, printed_number}`, with `statement` for the k-th excerpt printed under a paragraph and `position` before or after for an anchor. "After paragraph 14" is an anchor on paragraph 14 of the Part the practitioner was reading. A reworded paragraph is one decision. Take reworded paragraphs one at a time, each through steps 3 to 7 before the next: wording changes are never approved in a batch. Structural edits stated in one instruction go in one preview, and may share it with one reworded paragraph. Ask in one line when a printed number or a Part is unclear, never guess.
3. **Compose a reworded paragraph.** Build it on the practitioner's direction, whether they gave wording or described the change. Fix spelling and grammar. Fill a blank from the record. A blank the record cannot fill is asked about in one line and never invented. Keep every qualifier, burden word, date, name, figure, citation, pinpoint and quotation the direction does not change. Use capitalized terms as defined in the rendered mockup's earlier paragraphs, and follow the `style` block (step 8). On a proposition or statement of law, change only what the practitioner directed, never the legal effect, because that would be a statement of law. On a rhetorical paragraph, decide whether the revised wording states law or fact and pass `states_law` and `states_fact`. Compare the result with the record. Flag a date, name, figure or citation that conflicts with it, in one plain sentence per flag, and pass the flags as `review_flags`. The op's `choice` is `proposed` when the paragraph is, character for character, wording the practitioner typed in one turn, and otherwise `alternative`. `proposed_text` is the practitioner's request as they gave it.
4. **Preview.** Call `drafting_forms__preview_edit` with the database path, the Writing, the session token, `seen_revision` and the ops. It writes nothing. Its refusals:
   - `seen_revision_unknown` or `changed_since_seen`: a paragraph the edit touches is not as the practitioner saw it. Say so in one line, naming each paragraph `changed_since_seen` lists, re-render, present the mockup and ask again. Never re-aim the instruction at the new numbering.
   - `foreign_job`: refuse in one line naming each job as `Job #<id>: <title>`. Nothing is written.
   - `guard_refused`: quote `consequences.guard_refusals` verbatim. When it is the guard keeping an attached fact in the form's facts Part, ask in one line whether to detach the fact from the submission named. Detaching also drops it from that submission's argument wherever the submission prints. On yes, preview again with `detach: true`.
   - Any other refusal (`not_found`, `ambiguous`, `unsupported`, `move_across_parts`, `recast_type`, `not_placed`, `no_change`, `no_printed_change`, `exhibit_excerpt`): relay its `note` in one line. Nothing is written.
5. **Show it.** One reply, in this order:
   - each flag sentence from step 3, as plain text;
   - each block of the preview's `diff`, verbatim and whole, as its own fenced code block, never nested inside an outer fence and never paraphrased. The reply holds no other fenced code block;
   - under a separate heading, the session's own reading of the trial for sense: wording that read as fact and now prints as argument, or the reverse; a cross-reference such as "as set out in paragraph N" that now points elsewhere; a defined term now used before it is defined. Then the consequences that matter, in plain lines: markers added or cleared, `review_reraised`, criteria gained or lost, `other_filings` and `detached`. The reading is advisory and states no law;
   - one line asking the practitioner to reply yes to apply it, or to say what to change.

   The preview's trial mockups (`preview_paths`) may also be presented as file cards (`shared/present-files.md`), but never in place of the blocks. The reply uses no decision form, widget or `AskUserQuestion`: the practitioner-words gate reads only a typed approval. Put the reply in the final reply text, or in `SendUserMessage` when tool calls are still pending, because text between tool calls is not shown verbatim. This is one place chat carries document text, an exception to section 3's "Chat is not the review surface". The mockup stays the review surface after the write.
6. **The answer.** A bare yes (yes, approved, ok, go ahead) approves the preview shown. A change request starts again at step 2 or 3 and previews afresh. A withdrawal applies nothing and closes the item.
7. **Apply.** Call `drafting_forms__apply_edit` with the database path, the `preview_token`, the session token, and the render inputs section 11 passes (`draft_dir` and the identity values). One preview, one approval, one call. Its refusals: `stale_preview` (a touched row changed since the preview; the edit is not applied), `foreign_job`, `guard_refused`, and an unknown, expired, used or other session's token. Each is said in one line, then re-render, present and preview again. A hook refusal is quoted verbatim and stops: no retry and no reworded text. On success the result's `render` is the re-render: present it (section 11), and its `revision` is the new `seen_revision`. 🧐 re-raises where the edit changed approved wording.
8. **Style.** Read the `style` block from `probanda.json` through `/practice-data`. If it is absent, ask once for the spelling convention, in a data form, and write the answer back there, as counsel's review does with its `review` block.

## The structural ops

- **move**: a paragraph moves among its own kind within its Part: a fact among the form's facts, a submission among submissions (an anchor on a proposition places it after or before that proposition's submission), an order among orders. A move to another Part is a recast. The Written Arguments print no fact order, so a fact moves on the form only. `document: both` moves a submission or order on both documents. A move changes no wording, so 🧐 is not re-raised, and a number typed into wording ("see paragraph 3") is not renumbered.
- **recast**: a paragraph becomes another type in a Part that holds that type: a form fact recast into the legal basis becomes a new submission, and a submission recast into the facts Part becomes a new fact, each with the source's text, placed at the anchor. The source comes off the documents named. The new type is a closed menu, the types the anchor's Part holds (`recast_menu`): offer it to the practitioner in plain text before previewing, or, when it holds one type only, say which in the preview's reading. A new submission prints bold and numbered, and owes its 🧾 and 📚 until facts and law are linked. Adding the text to an adjacent submission is a reword of that submission, not a recast.
- **remove**: takes a fact, submission or order off one document, or `both`. It stays in the pool, held in reserve 🂡, and its audit row names it for a later restore. "Remove" means remove. Kill only when the practitioner says kill.
- **restore**: puts a removed row back where it was, named by the remove's audit row id (`paragraph-revision.md` section 8).
- **kill**: a submission or proposition the practitioner rejects. A killed submission comes off every drafting Writing in the same write, and is kept, never re-proposed.

A proposition or a statement prints under its submission or proposition and is not placed on a document by itself: it is reworded or killed here, and anything else is a job.

The layout of step 5 for a reworded fact with one flag standing, shown indented so it reads as a literal example:

    The invoice in the record (Ex. 4) shows delivery on 2 April 2025, not 3 April.

    ```
    Notice of Application
    Part 2 ¶3, reworded
        before: The invoice was delivered on April 2nd 2025.
        after: The invoice was delivered on 2 April 2025.
    ```

    ### Reading

    No cross-reference or defined term changes. 🧐 re-raises on Part 2 ¶3.

    Reply yes to apply this, or tell me what to change.

## Material to be relied on

A request to swap two lines of a Writing's material to be relied on ("swap the affidavits at 2 and 3 in Part 4"), or to move one to another position, changes their order, not their wording, and is not a quick edit: the tools above do not place material. It runs in any session, holding a job or not, takes no job, and writes through `/drafting-data` alone, by `paragraph-revision.md` section 7 (Material move).

1. **The form only.** The route moves the material the Writing's form lists (a Notice of Application's Part 4, an Application Response's Part 6).
2. **Locate and foreign-scope read.** Find the two material lines by the positions the practitioner names and run the move's foreign-scope read, both through `/drafting-data`. A hit is refused in one line naming the job as that file words it. Any other refusal that file words (a sent or retired Writing, a position out of range, two rows sharing one place) is relayed in one line. Either way nothing is written.
3. **Swap.** One swap is one write, by that file's one-script swap. "Move to position K" runs as consecutive swaps of neighbours, each its own write, locating afresh before each. It stops at the first swap that writes nothing and reports the order as it then stands.
4. **Confirm and re-render.** Confirm each swap through `/drafting-data`, then re-render (section 11). Reply in one line that the list order changed and how exhibit numbers follow, as `paragraph-revision.md` section 7 words it for this Writing: on a VanIAC submissions package only documents first numbered in this draft renumber, and on any other Writing the swapped documents' "Ex. N" follow the new order. A swap that wrote nothing is said so, and the mockup is re-rendered. A hook refusal is quoted verbatim and stops: no retry.

No paragraph is composed or shown, no approval is asked and no style is read, because no wording changes. 🧐 is not re-raised. The "Ex. N" citations the mockup prints follow the new order at render time, but a number typed into wording ("Ex. 3") is not renumbered.
