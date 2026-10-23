Read when: Dispatch found no job and the `live` lane's Loose Threads count is 20 or more, or the practitioner asks to rank or triage the loose threads (SKILL.md section 14, Dispatch), or the practitioner says to work on the loose threads, or the held job's intent is to work them.
Assumes SKILL.md is loaded. Rules are not restated here.

## Section 14: Loose-thread triage

**What it is.** An outlining session, under Branch B's rules (`references/job-session.md`): a thread outlined here is a job this session created, under Dispatch's rule for such a session (`references/dispatch.md` section 14), outlining a loose thread consumes it, leaving it touches nothing, and dropping it discards it on the practitioner's word only. A loose thread cannot be shelved or superseded. The session ranks every open thread best to worst for follow-up and shows the order on the Loose Threads page. Ranking orders, it never removes: however weak a thread, the session never drops it on its own judgment. A thread captured after the ranking shows as unranked until the next ranking. The route "Working the threads without a pick", below, is the one case where a thread is consumed without being outlined: the job that did its work consumes it. That route is not an outlining session.

**Deferred threads.** A thread whose line in the `loose_threads` lane ends ` · deferred` was set aside by the practitioner, usually with the status button on the Loose Threads page. Leave it as it is: do not rank it, propose it, or offer to discard it again, unless the practitioner asks about it or asks for the deferred threads. Read the state from `board_card` only. To defer a thread or bring one back on the practitioner's word, use `/drafting-data`'s deferral write ("Deferring a loose thread").

**Step 1. Read every loose thread once.** One `board_card(lanes: ["loose_threads"])` call. No second read until a write changes the lane.

**Step 2. Describe, then rank, every open thread.** Two passes over every thread, including a thread ranked before, but not a deferred one.

**2a. Write a job description for each thread.** State the work the thread asks for, in actionable form. It restates only what the thread says: no position, figure, statement of law, recommendation, or research question worded beyond the thread's own words, and never time remaining or a deadline. The idea stays as captured. For example, the thread "Would you like me to research Rule 22-3 on two points? First, whether the bracketed notes at the head of new Form 32 must be reproduced in the document or are only drafting instructions. Second, the page formatting that governs the 10-page limit." becomes "Research Rule 22-3 regarding: 1. Should the bracketed notes at the head of new Form 32 be reproduced or are they only drafting instructions? 2. What page formatting governs the 10-page limit?"

**2b. Rank the threads as jobs.** Give each a group, a rank and a reason, judged on its job description. The group is what the thread says, exactly one of seven:

1. **`decision`: practitioner remarks and decisions already made.** The practitioner's own instruction or decision.
2. **`tooling`: plugin and tooling feedback.** A tool failure, a missing feature, a skill or page defect. A thread about the plugin, its tools, skills or pages is `tooling` even when the practitioner said it: `decision` is for decisions about the matter.
3. **`housekeeping`: matter-data and law-folder housekeeping.** Ingesting a document, adding or correcting an authority row, filing a text.
4. **`research`: research offers and research questions.** An offered research run or an open question about the law.
5. **`authority`: Writing doesn't match an authority as cited.** A proposition, pinpoint, excerpt or rule wording that departs from the authority.
6. **`evidence`: Writing doesn't match the evidence or pleadings.** A fact, pinpoint, exhibit letter or party that departs from the record.
7. **`other`: miscellaneous.** Anything that fits none of the above.

Rank 1 is the best to follow up. A thread that settles or unblocks others ranks above the threads it settles or unblocks: a decision settles other threads, a tool failure blocks the downloads, currency checks and review pages other threads need, housekeeping puts on file the texts research and checks read, and a research answer decides what a correction says. The reason is one line saying why the thread sits where it does. It states no law, and never names time remaining or a deadline. Write every description and rank in one script by `/drafting-data`'s ranking write ("Ranking the loose threads"), with its confirm-read. Do not ask the practitioner to approve the descriptions first.

**Step 3. Present the Loose Threads page.** Re-render with `draft_dir` and present the Loose Threads page from that render's `view_page_paths` as a file card (SKILL.md section 11, View pages). `pages_refused` means the page is stale: say so. Say in one line how many threads were ranked and that none was dropped. Then wait, unless the route below is running.

**Working the threads without a pick.** This route runs when the practitioner says to work on the loose threads, and in a session whose held job's recorded intent is to work them, where a bare "continue" is enough. It is not the triage offer and not an outlining session, so Steps 4 and 5 do not run: the held job is the record of the effort. Ask no question about which thread to take. What the practitioner says about how to proceed is applied to the job's work and is never captured as a loose thread (SKILL.md section 3, Captured ideas). One thread per instruction.

- **No job held.** Write the loose-threads job by `/drafting-data`'s fixed-text create ("The loose-threads job"), its intent the practitioner's instruction word for word and its title that instruction cleaned by §3's rule, assign it with `drafting_data__assign_job`, and carry on in the same turn. The instruction names the job it creates, so Dispatch's rule for a session that created a job is met (`references/dispatch.md` section 14). A session the assign call refuses says so in one line and stops.
- **Another job held.** The route does not run, because a session is assigned one job. Say in one line that a new `/draft` session takes the instruction.
- **Scope.** The loose-threads job covers the whole board: one scope row for every substance table. Where the held loose-threads job has narrower scope, the instruction is the scope expansion: write the missing rows by `/drafting-data`'s scope expansion, say so in one line, and ask nothing.
- **Re-rank first.** Read the lane by Step 1. When any open thread that is not deferred is unranked, run Step 2 in full, one script with its confirm-read, by `/drafting-data`'s ranking write, then Step 3 without its wait. Ranking writes no job.
- **Take the top thread:** the best-ranked open thread that is neither deferred nor in the `tooling` group. The choice is the session's and is never asked. `tooling` threads stay for the Suggestion Box and are not run through `references/suggestion-box.md` from here. With no such thread, say so in the report and write nothing.
- **Work it inside the held job**, as the job's own work. No job is created for the thread. Every stop stays (`references/job-session.md`, Announce and proceed): the scope read before every substance write, run with `/drafting-data`'s foreign-scope read, which refuses material another in-progress job holds, law only through `/legal-research`, nothing about time remaining, the obstacle rule, and a one-way-door act, which waits for the practitioner. At a stop, do the work up to it and name the one thing needed in the report. A thread of the `decision` group is applied as the practitioner's decision. A thread reporting a stored record that a primary source contradicts is corrected and reported by SKILL.md rule 9, without asking. Never discard a thread here: a discard is Step 4's.
- **Consume it** once its work is done, by `/drafting-data`'s held-job consumption write ("Consuming a loose thread the held job worked") with its confirm-read. A thread stopped part-way stays open. The job stays in progress while a thread it can take is left: its step is stamped and the job completed only when none is left, or when the practitioner says so.
- **Report in one paragraph or less:** the thread, what was done, anything that needs the practitioner, the count of open threads left, and the count of `tooling` threads left for the Suggestion Box. No pick question and no list of options.

**Step 4. Outline or discard only on the practitioner's word.** They say which threads to outline as jobs of their own and which to discard, by rank or by idea. Never infer a discard from a low rank. Which thread the working route above takes is the session's choice, never asked here.

- **Correct a description.** When they name a thread and give the description it should carry, write their words by `/drafting-data`'s correction write ("Correcting a job description") and re-render.
- **Pursue.** Outline it under Branch B (`references/job-session.md`). Outlining consumes it. The job's title, intent and steps are worded by `/drafting-data` §3's rule, with no adoption ceremony.
- **Discard.** Applied only on their yes, by `/drafting-data`'s drop write, naming each thread id. Then confirm-read the lane (the ids discarded, the count) and re-render.
- **Leave.** Nothing is written. A thread they do not name stays as it is.

**Checking plugin threads against the installed plugin.** Only when the practitioner asks for it. Tested only on the `tooling` group, so written for it.

- **4a. Check each thread against the installed plugin.** Read-only helpers, each taking three or four threads grouped by area, each returning only `DONE | PARTLY | NOT DONE`, one to three `file:line` evidence lines, and what is missing. How the threads divide among helpers is a mechanical choice stated in one line, as Branch A's fan-out is.
- **4b. Spot-check every evidence line that drives a decision** before reporting it.
- **4c. Report one table:** built (with where), partly built (with what is missing), not built.
- **4d. Disposition.** The practitioner says what happens to each row. A drop is applied only on their yes, by `/drafting-data`'s drop write, naming each thread id. Then confirm-read the lane (the ids discarded, the count), re-render, and present the Job Board page again.

**Tooling threads go to the Suggestion Box.** Once the practitioner has said what to pursue and what to discard, and before Step 5, run `references/suggestion-box.md` over every open `tooling` thread that is not deferred. An evaluator weighs each against doing nothing, and no thread is discarded or sent without the practitioner's answer. A plugin-related thread seen in another group is named to the practitioner in one line and stays where it is.

**Step 5. Record the effort as a Ready job**, worded by `/drafting-data` §3's rule. A queued job counts as open work against the Writing's `gate` criterion until it is completed or shelved.

Deadline isolation and the HTML pages rule bind here as everywhere: no page is read, grepped, parsed or written by the session, ranks and job descriptions are read through `board_card` only, and nothing about time remaining enters a rank, its reason or its job description.
