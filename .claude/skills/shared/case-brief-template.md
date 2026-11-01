# Case brief template

The one source for what a case brief is, its shape, and how it is saved. `/case-brief` runs it, `research-agent` writes to it under `mode: case_brief`, and `brief-reviewer` checks against it.

## What a case brief is

A case brief is a one-page structured summary of one decision in someone else's case. A practitioner reads it to compare that case with their own matter. It is usually asked for because a submission relies on the case.

**Never of the working matter's own litigation.** A decision in the working matter's own proceedings is never briefed, whoever asks and however it is cited. A request for one is a mistake about what a case brief is: write nothing and say so in one line, "A case brief summarizes another case for comparison; this decision is in this matter's own litigation, so I have not briefed it."

**It names nothing of the working matter.** No party, counsel, practitioner, matter number, date, amount, document or fact of the working matter appears in it, and it says nothing about how the case bears on the matter. Why the case matters belongs in the Writing that relies on it.

**It says what this decision held, never whether it is still good law.** Noting up is separate work. The Case part ends `Not noted up by this brief.`

## Shape

Eight parts, in this order. Each item is one numbered paragraph, numbered from 1 through the whole brief and never restarted at a heading. A part with nothing to say holds one item reading `None.` Together they fit on one page, so keep only what the holding turns on.

| Part | Slot | What it holds |
|---|---|---|
| Case | `case` | Prose, unnumbered: the style of cause, the neutral citation, the court, the judge or panel, the date of the reasons, then `Not noted up by this brief.` |
| Facts | `facts` | Only the facts the holding turns on, an outline and not the narrative. No citation needed |
| Procedural history | `procedural-history` | How the case reached this court and what relief was sought |
| Issues | `issues` | Each legal question the court decided, as a question. Never one raised but not reached |
| Holding | `holding` | The court's answer to each issue, in the issue's order, each citing its pinpoint |
| Ratio decidendi | `ratio` | Each principle that decided the case, in the court's own voice, each citing its pinpoint |
| Obiter dicta | `obiter` | Each non-binding remark on the law worth keeping, in the court's own voice, each citing its pinpoint |
| Disposition | `disposition` | Every order made: the main result, any money, costs, any other relief, and any condition or timeline |

A statement of law is ratio when removing it would change the outcome on at least one issue, and obiter when the court could have reached the same result without it. When uncertain, the item's sentence opens `Ratio (arguable):` or `Obiter (arguable):` and ends with a one-line reason. An arguable ratio goes under Ratio decidendi and an arguable obiter under Obiter dicta.

### An item of law

Every Holding, Ratio decidendi and Obiter dicta item has this form in the scratch copy, from one passage of the decision:

```
<n>. <one sentence: what the passage says>
   Pinpoint: <the pinpoint>
   > <the verbatim passage at that pinpoint>
```

Each passage is in the court's own voice, by `shared/authority-claim-verification.md` §3. `case-brief/agents/brief.md` gives the reading rules.

## The scratch copy

`research-agent` writes the brief to the scratchpad with `research_filing__write_scratch`, as `<File stem>.md`, and returns only:

```
Brief scratch: <the path the tool returned>
```

The file holds, first, `File stem:`, `Style of cause:` and `Citation:` lines, then one `## <Part>` heading per part in the order above.

## Saving it

Save only after `brief-reviewer` returns `complete`. These are lawyer's own tools. Follow `shared/legal-research.md`'s persist step 1 ("After the answer, the caller persists it") with these differences:

- **Writing.** `drafting_data__create_writing` with the same `tree` and `recipient`, `title` the `File stem:`, and `kind` `case_brief`. A caller holding a job uses its `db_path` and proceeding, as there.
- **Authority.** Reuse the row the job's scope names. With no job, reuse the proceeding's row with that `citation`, and insert one (`kind` `case`) only when it holds none.
- **Items.** Read `B` as that step does. One `drafting_data__execute` script: for each Holding, Ratio decidendi and Obiter dicta item `n`, `INSERT INTO statements_of_law (id, proceeding_id, authority_id, pinpoint, excerpt, source, verification)` with id `B + n`, the authority's id, and `'primary'` and `'lead'`, then `INSERT INTO filing_law (filing_id, statement_id)`. The same script writes one `filing_prose` row per slot in the table above: `case` as written, and every other slot as its items' sentences, one per paragraph, each item of law ending ` <!-- statement_of_law_id <B + n> -->`.
- **Copy.** `drafting_forms__render` with `documents: ["General_writing"]`, then `research_filing__save_answer` with that document's `path` as `from_render`, `filename` `<File stem>.md`, and as `destination_dir` the folder under `6. LAW\` that holds the decision. A caller holding a job also passes the job's `db_path`, `ticket_id` and `claim_no` and its own `session_token`, so the job's card lists the brief. A result reading `job.recorded: false` means the job is no longer the caller's: the brief is saved, so stop and report.
- **A refusal.** When a `drafting_*` tool refuses, write nothing more to the Writing: save the `Brief scratch:` path as `from_scratch` and name the refusal in your relay.

The file stem is `YYYY-MM-DD case brief <style of cause>, <citation>`, today's date first. A re-brief of a case that already has a saved brief reuses that brief's file stem, date included, and saves onto the same Writing, the `case_brief` Writing with that title: it creates none, and its `drafting_data__execute` script first deletes the Writing's `filing_prose` and `filing_law` rows and each statement those named that no other Writing cites, then writes the items as above. `save_answer` never overwrites and takes the next free ` vN` itself, so the save is that brief's next version.

A case brief is a lead, not an authority. Never ingest a brief, and never read it as the decision's own text.

## On a held job

A brief job's steps are `Get the decision`, `Brief the decision` and `Save the brief under this job`. Set each done with `drafting_data__set_step` `status: "done"` as its work finishes, and only after that work ran. A step blocked by a missing credential or an unreachable source is set to retry, never done. Complete the job by `/draft`'s `references/job-session.md`, Complete, which checks that its card lists a saved brief. A job on a decision in the matter's own litigation is left in progress for the practitioner, with the one line above.
