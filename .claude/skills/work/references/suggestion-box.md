Read when: Loose-thread triage reaches the open `tooling` threads (`references/loose-thread-triage.md`, "Tooling threads go to the Suggestion Box").
Assumes SKILL.md is loaded. Rules are not restated here.

## Section 14: The Suggestion Box

**What it is.** A `tooling` loose thread is feedback about the plugin. It does nothing for the matter, so each one is weighed once against doing nothing. A thread that loses is offered for discard. A thread that wins is restated as one short paragraph with every person, entity and matter removed, and shown to the practitioner as a suggestion card. Nothing is discarded and nothing is sent without the practitioner's answer, which for a card is their click on it.

1. **Preconditions, checked before anything is asked.**
   - `legal_commons__configure_status` reports `configured: true`. If not, say in one line that the Suggestion Box needs Probanda's key, entered once on this device, and offer to set it up (`cloud_key__configure_credential`) or, for a practitioner with no key, to ask Probanda for one (`key_request__submit`), naming neither tool to them, and skip the rest of this reference: the tooling threads stay as they are.
   - The matter's database holds the v75 columns: `SELECT COUNT(*) FROM pragma_table_info('seeds') WHERE name = 'discarded_at';` through `/drafting-data`, expected `1`. If `0`, say in one line that the matter's records need an update before suggestions can be sent, and skip the rest.
2. **Take the open `tooling` threads** from `board_card`'s `loose_threads` lane, as last read. Skip the deferred ones. Set aside any whose rank reason says it blocks live work on the Writing (a tool failure that blocks the downloads, currency checks or review pages other threads need), and name them in one line. They stay on the board.
3. **Spawn `litigator:suggestion-evaluator` once** for the whole batch, with a JSON list of `{id, idea, rank_job}` and nothing else: no matter name, no path, no rank reason.
4. **Verdict `unscrubbable`.** List the threads in one line, each by its own words as the Loose Threads page prints it. They stay on the board.
5. **Verdict `do_nothing`.** One list, each line the thread in its own words as the Loose Threads page prints it and the evaluator's reason in plain words, then one plain-text question: discard all of these? The practitioner may name any to keep. This is a decision asked under `/show-me`. Discard only on their yes, by `/drafting-data`'s drop write ("Dropping a loose thread") naming each id, then its confirm-read.
6. **Verdict `suggest`**, one per turn, in rank order. The thread is shown as a suggestion card, built, scrubbed and waited on as `/lawyer:suggestion` section 6 says, and the chat says nothing about it: no summary, no question. The card's click is the practitioner's answer.
   - **Build** with `origin: "probanda"`, `source: "llm"`, `skill: "draft"`: the pain point is the paragraph's pain, and each change in it is an item, every block marked `guess: true` (the words are Probanda's), and an item marked `visual: true` when it changes how something looks.
   - **`submitted`.** Write `/drafting-data`'s "Marking a thread suggested" for that thread, then its confirm-read. Say nothing about the suggestion: the card shows its status.
   - **`dismissed`.** Discard the thread by `/drafting-data`'s drop write, then its confirm-read.
   - **The practitioner writes in chat before either.** Stop waiting and answer them. Mark the thread suggested, since its card now carries it and still works on its own, so the thread is never offered twice.
7. **The card carries only what it shows.** No thread id, matter path, database path or rank reason goes into it.
8. **Re-render once** with `draft_dir` after the batch, and present the Loose Threads page from that render's `view_page_paths` (SKILL.md section 11, View pages).

**When something fails.** A card the build still refuses after one rescrub: the thread stays open, nothing is stamped, and say in one line that it could not be put in general terms, never the text. Do not ask about that thread again in this session unless the practitioner asks. A card submitted whose suggested write failed: say the thread will be offered again next time unless they discard it now. A discard or suggested write refused with `no such column`: the precondition was skipped, so say the matter's records need an update first, and stop. An evaluator return that is not the JSON list asked for: report that in one line, write nothing, and leave every thread on the board.
