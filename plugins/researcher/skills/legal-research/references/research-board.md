Read when: the practitioner asks to research a board's research jobs together, or `/work` hands the session here to do so.

# Board mode: several research jobs on one board

One session, the main session, works every research job on one Work Board. The `researcher:research-triage` agent decides which jobs wait on which, and how a later question should be reworded. This session follows its blockers mechanically and runs each job's research through the gate's steps 2a to 5. Subagents cannot spawn agents, so every agent a job needs is spawned here.

A research job is a queued, unshelved job whose work is a question about what the law is. A case brief job, its title opening `Brief the case: `, is none: `/case-brief` works it. Every write below is `/drafting-data`'s (§3m, and the sections it names).

## Jobs held

- Hold at most three research jobs at once. Assign each with `drafting_data__assign_job` under its own token, minted for that job by `drafting_forms__bootstrap` `{db_path}`. Pass that job's token and `claim_no`, and never another job's, wherever a rule names this session's token. A job awaiting the practitioner's decision on a rewording counts toward the three.
- Each held job is a held `/draft` job for every rule in `SKILL.md` and `shared/legal-research.md` that names one: the scope check asks nothing but the rewording proposal ("A research question holds one question"), `Job question:` is its intent, gaps become steps, sources to get are recorded, and the lock is read before every dispatch.
- After a new question is written as a job, spawn `researcher:research-triage` again with every job's state, `New memo: none` and the saved graph, save its JSON over the graph, and act on it by §4 step 3.
- When a job completes, its slot frees, and the session goes on to assign the next ready research job on this board. It assigns no job that is not a research job on this board.

## 1. Start

1. Render the board (`drafting_forms__board_card`, `lanes: ["live", "completed"]`) and list its research jobs, with the saved memo path on each completed one's `answers:` line.
2. Spawn `researcher:research-triage` with `Jobs:`, `Memos:`, `New memo: none` and `Graph: none`. Save its JSON with `research_filing__write_scratch`. That file is the graph: each blocker's kind and reason live only there.
3. Write its `edges` (§3m, Blockers). Put each `new_jobs` entry to the practitioner, and write it only on their yes (§3m, A premise job).
4. Show the graph once, as a picture: one numbered column per `waves` entry, each job with its blockers' kinds and reasons. The columns are a picture only. Nothing waits for a column to finish.

## 2. Release

Walk the re-rendered board's Ready lane in its own order. Assign each research job there until three are held. The board already holds a blocked job out of Ready. For each job assigned, run `SKILL.md` steps 2a to 5, with these spawn template fields:

- `Background memos:` the saved memos of every job that blocked this one, in the graph, and the template's instruction line after it, word for word.
- `Flag unsettled:` the triage's `flag_for` instruction for this job, or `none`.

## 3. Retrieval

The jobs share the retrieval lanes, which the doctrine sets. One `research-paralegal` at a time across every job. One `legislation-fetcher` at a time, which may run beside the paralegal. `citation-checker` never runs beside the paralegal or another `citation-checker`. Westlaw's three runs in flight are the paralegal's to count. `research-agent` instances may run side by side. While one job waits for retrieval, run the other jobs' work that does not need it. Never hold a ready job back for another job to finish.

## 4. A memo lands

1. Once memo-reviewer's loop on it has ended (`shared/legal-research.md`, "memo-reviewer checks every memo before it is saved"), save it under its own job by the gate's persist step 1 (its Writing on that job's proceeding, and `research_filing__save_answer` with that job's `db_path`, `ticket_id` and token), relay it as the gate's step 5 says, and complete the job only by `/draft`'s job-session Complete step, which refuses an `INCOMPLETE` memo (`drafting_data__complete_job` with that job's token).
2. Spawn `researcher:research-triage` again, with every job's state, `New memo:` this memo, and the saved graph. Save its new JSON over the graph.
3. Write its `edges`. Put each `new_jobs` and `close` entry to the practitioner, and write it only on their yes (§3m).
4. For each `reword` entry, assign that job when a slot is free, dispatch nothing for it, and show the practitioner the rewording review below. On approval, write the new question (§3m, Rewording a held job). On "keep the original", write nothing. Either way, then run the job by step 2, with its blockers' memos still passed forward.
5. Release whatever is now ready (step 2).

Board mode ends when no research job on the board is queued or held. Then show each memo saved in this run as its file card.

## The rewording review

Never apply a rewording without the practitioner's approval. Show, in this order:

1. The original question in full, in a code block.
2. The earlier memo as a file card, with each passage the reasons rely on highlighted, by `/show-me`'s marking conventions. The caption names the memo, the section and the colour legend.
3. The proposed question in full, in a code block.
4. The reasons, each tied to a highlighted passage, quoting the memo rather than restating it as law.
5. One plain question: approve it, change it, or keep the original.
