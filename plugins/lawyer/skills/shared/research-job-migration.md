Read when: a board opens (`/work` Opening, `/draft` session entry, `/legal-research` board mode), a shelved job is restored, or `/legal-research` is handed a job whose work is research and that is not in the form.

# Migrating a research job

A legal research job reads `Legal research: <issue>` (`shared/legal-research.md`, "Research runs only under a job"). A live job, queued or in progress, whose work is a question about what the law is and that is not in the form starts no step until it is migrated: no dispatch, no retrieval, no step write, no memo work. Completed and deleted jobs are not migrated. A shelved job is migrated when it is restored, before any of its work. A case brief, a note-up and a job holding a Proposal's key are no research jobs and keep their own titles.

## The sweep

When a board opens, read its live jobs (`drafting_forms__board_card`, `lanes: ["live"]`). For each one whose title does not open `Legal research: `, judge one thing: is its work a question about what the law is? Each job judged research goes to the review below before any job on that board is dispatched. A job judged not research is left alone and never retitled to look like research. With none, say nothing. An unattended run dispatches nothing on that board, reports each job it judged research, and stops.

## The review

One job per turn, under `/show-me`. Show, in this order:

1. The job's current title and intent in full, in code blocks.
2. Any memo saved under the job, as its file card.
3. The proposed title and intent in the form, in full, in code blocks (`shared/research-memo-template.md`, rules A to D).
4. One plain question: approve it, change it, or say this is not a research job.

Never offer to keep the original: a research job cannot stay out of the form. Their approval goes in the same turn's write (`drafting-data/references/jobs-stock.md` §3m, "Migrating a research job"), and nothing is written without it. "This is not a research job" writes nothing, and the job is left alone.

## After the write

Done steps keep their stamps, and every saved answer stays. A saved memo was written to the old question, so the job is not complete until its memo's Issue holds the new intent: at the job's next research, the gate re-invokes the agent with `Review:` to rewrite the memo to the job question, through memo-reviewer's loop (`shared/legal-research.md`, "memo-reviewer checks every memo before it is saved"). Migration changes no blocker. A board-mode run afterwards runs the research triage again on the new wording.
