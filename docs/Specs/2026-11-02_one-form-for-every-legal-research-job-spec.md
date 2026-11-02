# Spec: One form for every legal research job

Status: implemented 2026-11-02. Written in a matter session from Brahm's instructions; implementation was handed to Claude Code.
Plugins: `researcher` (the `/legal-research` gate, its doctrine, the memo template, the audit and triage agents), `litigator` (`/drafting-data`, `/draft`, `/work`), `lawyer` (the data server's job tools).
Paths are repo source paths, checked at HEAD 27cf07d (2026-11-02); see §10 and §11.
Related specs: 2026-10-31_job-question-from-intent-spec.md (the Job question is the job's intent), 2026-10-31_memo-template-job-issue-yields-spec.md.

## 1. Problem

Legal research has no single form, and nothing enforces one:

- Research can run with no job at all. The gate works for "a caller holding no job", and with no board a research question job is not written.
- A research job's title and intent are copied from whatever words reached it: the practitioner's question "character for character. Never cleaned" (§3l), an audit offer's `job:` line (§3i), a triage proposal (§3m), or the session's own outlining words. Live jobs on real boards carry lowercase labels as titles and conversational sentences as intents.
- The question rules (one question, makes sense on its own, at most one list, nothing of the working matter) exist only as memo rules (research-memo-template.md A to C). They are first applied when the job is dispatched, after the job already exists, and never by the data server.
- Nothing marks a job as research, so the server cannot tell a research job from any other job.

## 2. What Brahm asked for (his rules, restated)

1. **Research always has a job.** Any legal research, whether it hasn't started or is under way, is tracked by a job: a job on a Work Board (a Writing's board, a board with no Writing, or a proceeding's board), including one outlined from a loose thread. No research runs off the cuff without a job.
2. **One form.** A legal research job reads `Legal research: <issue>`. The issue is:
   - zero, one or two context sentences, then
   - exactly one question: one sentence ending in `?`,
   - holding at most one list, and that list conjunctive (joined by "and"), never a list of alternatives,
   - naming nothing that identifies the client, the parties, the people involved or the proceeding. Context may hint at the setting (for example, "a commercial tenant"), never identify it.
3. **A memo, always.** Every legal research job produces a legal memo. No research job ends in an off-the-cuff answer.
4. **Future jobs.** Rules 1 to 3 are enforced for every job written from now on.
5. **Existing jobs.** Every existing research job must be migrated into the form before any work can start on any of its checklist items.

## 3. Goal and non-goals

Goal: every legal research job, new or migrated, is marked as research, has its issue in the one form, is the only route by which research runs, and completes only with a saved memo. The data server enforces what it can check mechanically. The gate and the reviewing agents enforce what needs judgement.

Non-goals:
- Case brief jobs (`Brief the case: `) and note-up jobs keep their own fixed titles and outputs (see §9, Q1).
- A hunch stays allowed as long as it is plainly labelled a hunch and nothing relies on it (`shared/legal-research.md`). A hunch is not research and needs no job (see §9, Q2).
- How the memo itself is written, beyond its Issue, is unchanged.

## 4. Design

### 4.1 Definitions

- **Legal research job**: a job whose title starts with the fixed prefix `Legal research: ` (capital L, colon, one space). The prefix is the marker, as `Brief the case: ` already marks a case brief job (`source/lawyer/mcp/src/submission/forms/brief-job.ts`, `BRIEF_JOB_PREFIX`). No schema change is needed.
- **Issue**: the text after the prefix. The job's **intent is the issue, verbatim**, without the prefix. The title is `Legal research: ` followed by the intent, character for character.
  - This keeps the earlier spec intact: `Job question:` is the job's intent, and a job's memo's `## Issue` holds the intent verbatim. So the memo's Issue never starts with "Legal research:".
- **Unmigrated research job**: a live (queued or in progress) job, shelved or not, whose work is a question about what the law is (the existing test in `research-board.md`: "a queued, unshelved job whose work is a question about what the law is"), and whose title lacks the prefix or whose issue fails the form.

### 4.2 The form, split by who checks it

| Part of the form | Checked by | How |
|---|---|---|
| Title is `Legal research: ` + intent, exactly | Data server | String compare |
| Intent has 1 to 3 sentences | Data server | Sentence split on `.`, `?`, `!` followed by space or end; abbreviations and citations need a small allow-list (§9, Q4) |
| The last sentence ends in `?`, and no other sentence does | Data server | Character check |
| No line break, and the title fits the job text limit (`TEXT_MAX` 500 in `rewrite-job.ts`) | Data server | Existing check |
| One question only (rule A) | Gate's scope check and memo-reviewer | Judgement |
| Makes sense on its own (rule B) | Gate's scope check and memo-reviewer | Judgement |
| At most one list, and only a conjunctive one (rule C, changed) | Gate's scope check and memo-reviewer | Judgement |
| Nothing identifying the client, parties, people or proceeding | Gate's scope check and memo-reviewer | Judgement |

Rule C changes. Today it reads "holds at most one list of alternatives (one axis)", with the example "Is gambling legal in BC or Alberta?" Under Brahm's rule the one list allowed is conjunctive ("in BC and Alberta"), and a list of alternatives is not allowed. The template's rule C and its examples are rewritten to match (see §9, Q3).

### 4.3 Enforcing the form on new jobs

**Data server (mechanical, cannot be skipped):**
- `drafting_data__create_job` refuses a title starting `Legal research: ` that fails any data-server row of §4.2, writing nothing, with a refusal code (for example `research_form`) naming the failed check in plain words.
- `drafting_data__rewrite_job` and every other path that sets a job's title or intent apply the same check when the new title starts with the prefix. Today `rewrite_job` sets the title but not the intent. It gains the intent, set together with the title for a research job, so the two cannot drift apart.
- `drafting_data__execute` refuses any script that inserts a `tickets` row, or changes a `tickets` row's `title` or `intent`, when the result starts with the prefix. Research jobs are written only through the job tools. This matters because §3i and §3l jobs are written today by hand-run `INSERT INTO tickets` scripts (`jobs-stock.md` §3i), which no `create_job` check would see. Both sections move to one `create_job` call.

**Skills and agents (judgement, before the job is written):**
- Every path that writes a research job builds its title and intent in the form, and runs the judgement rows of §4.2 before it writes:
  - §3l research question jobs (the practitioner's own question). The "character for character, never cleaned" rule is replaced: the session proposes the issue in the form, quoting the practitioner's words, and writes only on their approval. Their approval of the wording is their request.
  - §3i research offer jobs. The audit agent's Step 5 offer `job:` line (`shared/legal-audit-protocol.md`) is itself written in the form, as `job: Legal research: <issue>`. §3i still copies it character for character, and the data server still checks it.
  - §3m premise jobs and rewordings. `research-triage`'s `new_jobs` and `reword` entries return the issue in the form.
  - `/draft`'s `Research the test: <item label>` blocker (`draft/references/job-session.md`, Movers) and any research blocker from the obstacle spin-off. They become `Legal research: ` jobs. The fixed frame becomes the issue's context sentence, and the item label is generalised so it names nothing of the matter.
  - Outlining (`/work` Branch B, loose-thread outlining). A job the session judges to be a question about what the law is gets written in the form, never as a free label.
- The one-rewording proposal in "A research question holds one question" (`shared/legal-research.md`) stays the way a failing issue is fixed: one proposed issue in the form, approved by the practitioner.

### 4.4 Research always has a job

- **The gate.** `/legal-research` runs research only for a held `Legal research: ` job. On a question with no job held, its new first step writes one, by §3l in the form, on the practitioner's approval of the wording. It then assigns that job to itself and goes on. On a held job that is not in the form, it runs the migration (§4.6) first.
  - With no board, the job goes on the matter's proceeding board (`filing_id` NULL). The proceeding is the lowest-id one, or one inserted as the persist step already does. "With no board, write nothing" and "A caller holding no job records nothing" are removed.
  - In an unattended run, with no one to approve wording, the gate reports and stops (as "A research question holds one question" already does).
- **Board mode** (`research-board.md`) assigns only `Legal research: ` jobs. Its definition of a research job becomes the prefix.
- **`/work`'s hand-off** (`work/SKILL.md`, "A research question" → `/legal-research`) is unchanged, but the receiving gate now enforces the form.
- **Loose threads.** A research offer captured as a loose thread stays a thread: capturing it is not research, and no research runs from it. Research begins only when it is outlined or added as a `Legal research: ` job.
- **Data server backstop.** `research_filing__save_answer`, when given a `ticket_id` (`submission/forms/save-job-answer.ts`, which writes the `ticket_answers` row), refuses a job whose title lacks the prefix, with a code such as `not_research_job`. A memo can never be saved under an unmarked job. Case brief jobs, which also save answers, are exempt by their own prefix (Q1). `drafting_data__track_source` is left alone, because non-research jobs track sources too.

### 4.5 A memo, always

- `drafting_data__complete_job` refuses a `Legal research: ` job with no saved answer (a `ticket_answers` row whose file is a research memo), writing nothing.
- The skill rules that already apply stay as they are: a job whose last memo's `Confidence:` starts `INCOMPLETE` is not completed, and the memo's `## Issue` must hold the intent verbatim (`draft/references/job-session.md`, Complete). Where cheap, the server also reads the saved memo Writing's header and refuses an `INCOMPLETE` one.
- A research job is never completed, shelved or answered with a reply in chat in place of a memo. Shelving stays available (shelving is not completing).

### 4.6 Migrating existing research jobs

**What blocks.** No step of an unmigrated research job may start: no dispatch, no retrieval, no `set_step`, no memo work. Two locks enforce this:
1. **Judgement lock (the classification).** Only a session can decide whether an unmarked job's work is a question about what the law is. That decision is already made at every route into research: `/work`'s hand-off, board mode's job list, and the gate. Each runs the migration review first when the job is research and unmarked.
2. **Mechanical lock.** Once a job carries the prefix, the server checks the form on every write (§4.3). An unmarked job cannot have a memo saved under it (§4.4 backstop), so no research output can attach to an unmigrated job even if a session skips the review.

**Which jobs.** On every matter, every live job (queued or in progress, shelved included) whose work is a question about what the law is and that is not in the form. Completed and deleted jobs are not migrated. A shelved job is migrated when it is restored, before any of its work.

**The sweep.** When a board opens (`/work` Opening, `/draft` session entry, board mode's Start), the session lists the board's live jobs that are not fixed-text and not prefixed, and judges each one: research or not. Each job it judges research goes to the migration review before any job on that board is dispatched. A job it judges not research is left alone. It is never retitled to look like research.

**The migration review** (one job per turn, under `/show-me` and the rewording review in `research-board.md`):
1. The job's current title and intent in full, in code blocks.
2. Any memo already saved under the job, as its file card.
3. The proposed title and intent in the form, in full, in code blocks.
4. One plain question: approve, change, or "this is not a research job".

Never "keep the original". Not migrating is not an option for a research job.

**Writing the migration.** On approval, the new title and intent are written through `rewrite_job` (§4.3), which runs the form check. `rewrite_job`'s ready mode today refuses a job with a step done or a plan approved. Migration needs a third mode, `migrate`. It may run on a queued job, unlocked, whatever its steps' state, or on a job the session holds. It changes only the title and intent. It keeps every step, its words and its stamps, and every saved answer. It never runs without the approval recorded in the turn.

**Work already done.** A migrated job's existing memo was written to the old question. By the existing completion rule (the memo's `## Issue` must equal the intent), the job is not complete until its memo answers the new issue. The gate re-invokes the agent with `Review:` to rewrite the memo to the job question, and the result goes through memo-reviewer's loop. Done steps keep their stamps.

**Blockers.** Migration changes no `ticket_blocks` edge. A board-mode run afterwards re-runs research-triage on the new wording.

## 5. Constraints that must still hold

- The practitioner approves every new research issue's wording and every rewording or migration (no silent rewrite).
- One question per memo. Nothing of the working matter in a memo or a research job's issue.
- A job's memo Issue is the job's intent verbatim (2026-10-31 spec).
- No schema change: the prefix is the marker (Commandment 5; the legacy-store exception must not grow).
- Westlaw-first order, hard stops and the memo-reviewer loop are unchanged.
- Fixed-text job readers still match by title (`fixedText()` in `take-job.ts`). `Legal research: ` joins them only where a reader needs to, and not as a fixed text, since its words vary.

## 6. Options considered

1. **Title prefix as the marker, plus server checks, plus a judgement sweep at board open (recommended).** No schema change. It follows the `Brief the case: ` precedent, and the server enforces what it can.
2. **A new `tickets.kind` value `research`.** Rejected for now: it is a schema change on a legacy store (a minor version, and the Commandments' exception must not grow). It also still needs the same judgement to classify existing jobs.
3. **Gate-only enforcement (skill text, no server checks).** Rejected: it is the status quo's weakness. §3i and §3l jobs are hand-written SQL, and nothing stops a malformed job.
4. **An automatic data migration that renames research-looking jobs.** Rejected: whether a job is research is a judgement, and every rewording needs the practitioner's approval.

## 7. Implementation plan

1. Verify against HEAD (§10) and append a verification table.
2. Data server (`source/lawyer/mcp/src`):
   - add `RESEARCH_JOB_PREFIX` and a `researchFormProblems(title, intent)` check beside `brief-job.ts`;
   - call the check in `create-job.ts` and `rewrite-job.ts`;
   - add `rewrite_job`'s `migrate` mode and intent support;
   - add the `execute` refusal for prefixed `tickets` inserts and title or intent writes;
   - add the `not_research_job` refusal to `save-job-answer.ts`, exempting `Brief the case: ` jobs;
   - add the no-memo refusal to `complete-job.ts`;
   - update tool descriptions in `schema/submission-data.ts`;
   - write tests for each refusal and for `migrate` keeping done steps.
3. `drafting-data` (`jobs-stock.md` §3i, §3l, §3m; `jobs-create.md`): research jobs written by one `create_job` call in the form; delete the "character for character, never cleaned" rule for §3l and the hand-SQL shapes for research jobs.
4. `researcher`:
   - `shared/legal-research.md`: research needs a held prefixed job; the no-job and no-board paths write one; the migration review; delete "A caller holding no job records nothing" and the no-board "write nothing";
   - `legal-research/SKILL.md`: the gate's new first step;
   - `research-board.md`: the definition is the prefix, plus the sweep at Start;
   - `research-memo-template.md`: rule C becomes one conjunctive list, plus the identity rule, with new examples;
   - `legal-audit-protocol.md` Step 5: `job:` lines in the form;
   - the `research-triage` and `memo-reviewer` agents: proposals and checks in the form.
5. `litigator`: `/work` Opening and `/draft` session entry run the sweep; `draft/references/job-session.md`'s `Research the test:` blocker and research spin-offs become `Legal research: ` jobs; shelve-and-restore runs the migration on restore.
6. Commit on `main` by explicit pathspec and push. Finish with `Implementation of One form for every legal research job complete!`, then what you streamlined, what you verified and what you assumed.

Streamline and deburr first: each new rule replaces the text it supersedes in the same change.

## 8. Implementation criteria

1. `create_job`, `rewrite_job` and `execute` cannot leave a `Legal research: ` job whose title is not `Legal research: ` + intent, whose intent has more than three sentences, or whose question sentence is not last or does not end in `?`. Each has a test.
2. No research memo can be saved under a job without the prefix (test).
3. `complete_job` refuses a `Legal research: ` job with no saved memo (test).
4. `rewrite_job` `migrate` changes title and intent only, and keeps every step, stamp and answer (test).
5. No researcher or litigator text lets research run with no held job, or writes a research job's title or intent "character for character" from unformed words.
6. Research-memo-template rule C allows one conjunctive list and no list of alternatives, and states the identity rule.
7. Every route into research (`/work` hand-off, board mode, the gate) runs the sweep or migration review before the first dispatch on an unmarked research job.
8. Net skill-text line count does not grow by more than the new rules need: superseded text is deleted.

Scope: edit the source files the change needs (skill text, `mcp/src`, agents, docs), and write, update and run the tests it needs. Out of scope, because the orchestrating session runs them once after every spec lands: `build_plugin.py` and `check_plugin.py`. Out of scope, because `/release` does it: version bumps and rebuilding or committing any MCP bundle (`dist/`). Never build a `.plugin` archive. This change alters tool inputs and refusals, so the release is a minor version under CLAUDE.md's rule.

## 9. Open questions

The implementation adopted each assumption below as written.

- **Q1. Case briefs and note-ups.** Should case brief and note-up jobs also count as legal research jobs, and so produce a memo? This spec assumes not: each keeps its own fixed title and its own output (a brief, a note-up record).
- **Q2. Hunches.** Should a plainly labelled hunch stay allowed with no job? This spec assumes yes, because a hunch is not research and nothing may rely on it.
- **Q3. Rule C.** Brahm's rule allows only a conjunctive list. Is a question such as "Is X permitted in BC or Alberta?" now out of the form (two questions, so two jobs), or should "or" listing places or parties still count as one axis? This spec assumes out.
- **Q4. Sentence splitting.** Legal text holds abbreviations and citations with periods ("s. 164", "v.", "Inc."). The server's sentence count needs an allow-list or a lenient rule that leaves the hard cases to the judgement check. This spec assumes an allow-list, plus a check that the final character is `?` and that `?` appears only once.
- **Q5. Title length.** A three-sentence issue can make a long title. Keep `Legal research: ` + the whole issue as the title (Brahm's instruction, assumed here), or use `Legal research: ` + the question sentence only, with the full issue in the intent?

## 10. Verify against HEAD before building

Checked at HEAD 27cf07d (2026-11-02) by the session that wrote this spec:

| Claim | Repo source | Result |
|---|---|---|
| §3l title and intent: "their question, character for character. Never cleaned." | `.claude/skills/drafting-data/references/jobs-stock.md` line 466 | Confirmed |
| §3i title and intent: the offer's `job:` line, character for character; written by hand-run `INSERT INTO tickets` | `jobs-stock.md` lines 405-440 | Confirmed |
| §3m rewording guard requires `status = 'wip' AND locked_by` | `jobs-stock.md` line 494 | Confirmed |
| "A caller holding no job records nothing." | `.claude/skills/shared/legal-research.md` line 343 | Confirmed |
| Rule C: "holds at most one list of alternatives (one axis)" | `.claude/skills/shared/research-memo-template.md` line 132 | Confirmed |
| A job's memo's Issue is the job question verbatim if it meets A to C and names nothing of the working matter | `research-memo-template.md` line 137 | Confirmed |
| Research job defined by judgement: "a queued, unshelved job whose work is a question about what the law is" | `.claude/skills/legal-research/references/research-board.md` line 7 | Confirmed |
| `Brief the case: ` prefix marks a job kind in server code | `source/lawyer/mcp/src/submission/forms/brief-job.ts` line 2; `create-job.ts` line 158 | Confirmed |
| `rewrite_job` sets title and steps, not intent; ready mode refuses a job with a step done or a plan approved | `source/lawyer/mcp/src/submission/forms/rewrite-job.ts` lines 1-12 | Confirmed |
| Job text limit 500 characters, no line breaks | `rewrite-job.ts` lines 21, 62 | Confirmed |
| `tickets.kind` is `'work'` or `'charting'` only | `.claude/skills/drafting-data/references/schema.sql` line 1031 | Confirmed |
| `execute` refuses lock and stamp writes by column (`job_write_refused`), not title or intent | `source/lawyer/mcp/src/submission/backend.ts` lines 129-136 | Confirmed |
| A research job with an `INCOMPLETE` memo is not completed; the memo Issue must hold the intent verbatim | `.claude/skills/draft/references/job-session.md` line 97 | Confirmed (skill text only, not server) |
| `/draft`'s `Research the test: <item label>` blocker | `draft/references/job-session.md` line 82 | Confirmed |
| `complete_job` checks for a saved research answer | `source/lawyer/mcp/src/submission/forms/complete-job.ts` | **Not found**: no research-specific check |
| `save_answer` records the answer on a job only through `ticket_id` | `source/lawyer/mcp/src/submission/forms/save-job-answer.ts` lines 28-30, 83 | Confirmed. `write_scratch` (`files/research-filing.ts` line 310) takes no job |

## 11. Verification at build, and what the build changed

Checked at HEAD 2a2909a4 by the implementing session. The §10 claims read as stated at that commit, apart from the rows noted below.

| §10 claim | Result at 2a2909a4 |
|---|---|
| jobs-stock.md §3l, §3i, §3m lines | Confirmed: lines 466, 405-452, 493 (§3m's guard is one line earlier than §10 says) |
| "A caller holding no job records nothing." | Confirmed: `legal-research.md` lines 342-343 |
| Rule C and a job's memo's Issue | Confirmed: `research-memo-template.md` lines 132, 136-139 |
| Research job defined by judgement | Confirmed: `research-board.md` line 7 |
| `Brief the case: ` prefix | Confirmed |
| `rewrite_job` modes and limits | Confirmed |
| `tickets.kind` | Confirmed: `schema.sql` line 1031 |
| `execute` refuses by column | Confirmed: `backend.ts` lines 129-136 |
| `INCOMPLETE` and `Research the test` | Confirmed: `job-session.md` lines 97, 82 |
| `complete_job` has no research check | Confirmed |
| `save_answer` records only through `ticket_id` | Confirmed |

The build departed from the spec where the code showed the wording would break working jobs:

1. **`assign_job` and `take_job`.** `take_job` refuses a non-fixed-text title over 12 words (`long_title`), and it reads two jobs sharing two title words as duplicates. `legal` and `research` are two such words. A research title is exempt from the word limit, and the overlap check leaves the prefix out. Neither goes through `fixedText()`.
2. **The `save_answer` backstop.** §4.4 exempts only `Brief the case: `, but note-up records and scrutiny returns also save under a job. The refusal exempts a fixed-text job, a title opening `Note up` and a job holding a Proposal's key.
3. **The gate.** Research for a held note-up, scrutiny or case brief job, a `Note up paragraphs:` run, a currency check asked on its own and a scoped holdings dispatch keep running under their own routes.
4. **No matter at all.** §4.4 covers "no board". A question with no matter at all has no database to hold a job, so the gate asks which matter and runs nothing until told.
5. **A new guard.** §3i's duplicate rule matches no `create_job` guard, so `research_title` was added.
6. **`memo_incomplete` honours the practitioner's override.** `job-session.md` lets the practitioner complete a job without the research an `INCOMPLETE` memo names, by setting those steps cancelled or deferred. The server refuses such a memo unless a step is so set.
7. **A research job keeps its prefix.** `rewrite_job` and `execute` also refuse removing the prefix, so a job cannot leave the form by retitling.
