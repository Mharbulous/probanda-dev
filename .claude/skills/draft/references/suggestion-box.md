Read when: Loose-thread triage reaches the open `tooling` threads (`references/loose-thread-triage.md`, "Tooling threads go to the Suggestion Box").
Assumes SKILL.md is loaded. Rules are not restated here.

## Section 14: The Suggestion Box

**What it is.** A `tooling` loose thread is feedback about the plugin. It does nothing for the matter, so each one is weighed once against doing nothing. A thread that loses is offered for discard. A thread that wins is restated as one short paragraph with every person, entity and matter removed, for sending to Probanda as a suggestion. Nothing is discarded and nothing is sent without the practitioner's answer.

**Sending is not available yet.** No tool posts a suggestion, so this reference stops before the post: a thread the evaluator would suggest stays on the board (item 6). Never write `/drafting-data`'s "Marking a thread suggested" from here.

1. **Precondition, checked before anything is asked.** The matter's database holds the v75 columns: `SELECT COUNT(*) FROM pragma_table_info('seeds') WHERE name = 'discarded_at';` through `/drafting-data`, expected `1`. If `0`, say in one line that the matter's database needs the v75 migration, and skip the rest of this reference: the tooling threads stay as they are.
2. **Take the open `tooling` threads** from `board_card`'s `loose_threads` lane, as last read. Skip the deferred ones. Set aside any whose rank reason says it blocks live work on the Writing (a tool failure that blocks the downloads, currency checks or review pages other threads need), and name them in one line. They stay on the board.
3. **Spawn `probanda:suggestion-evaluator` once** for the whole batch, with a JSON list of `{id, idea, rank_job}` and nothing else: no matter name, no path, no rank reason.
4. **Verdict `unscrubbable`.** List the thread ids in one line. They stay on the board.
5. **Verdict `do_nothing`.** One list, each line the thread id and the evaluator's reason, then one plain-text question: discard all of these? The practitioner may name any to keep. This is a decision asked under `/show-me`. Discard only on their yes, by `/drafting-data`'s drop write ("Dropping a loose thread") naming each id, then its confirm-read.
6. **Verdict `suggest`.** One list, each entry the thread id, the title and the paragraph. Say in one line that they stay on the board until suggestions can be sent. Ask nothing and write nothing.
7. **Re-render once** with `draft_dir` if anything was discarded, and present the Loose Threads page from that render's `view_page_paths` (SKILL.md section 11, View pages).

**When something fails.** A discard write refused with `no such column`: the precondition was skipped. Say the matter's database needs the v75 migration and stop. An evaluator return that is not the JSON list asked for: report that in one line, write nothing, and leave every thread on the board.
