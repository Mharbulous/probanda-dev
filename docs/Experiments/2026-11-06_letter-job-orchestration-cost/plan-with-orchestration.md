# One letter job with phase steps

## Context

A letter Writing's save writes one stock job, `Deliver` (send, record as sent). Since 2026-10-23 no job covers drafting the letter, so the Work Board implies sending is the whole task. The practitioner wants the research-job model: one job for one letter, showing the letter's phases as its steps.

Decisions taken in this session (practitioner, 2026-11-06):
- (a) One job under a new title. Old letters keep `Deliver`.
- (c) Delivered, acknowledgement and follow-up are steps inside the job, after sending.
- (b)/(d) Steps that do not apply are omitted at creation.
- Criteria: the job's steps are the checklist. The goal_criteria lists and the criteria code stay unchanged.

Duplication check: no plan or issue covers this fix. Today's diagram `docs/diagrams/Built/Letter drafting.html` (ff552963) describes the current process. A busy peer session could not be asked, because the message expired undelivered.

## Scope

- **Covered:** every letter kind (`_NoVenue` letter kinds and a venue's `letter` kind) at its own save.
- **Unchanged:** `internal-memo`, `unstructured*`, a letter saved under the `Availability letter` job (it already has a drafting job, so it keeps `Deliver`), and every letter already saved.

## The job (fixed text, `drafting-data/references/jobs-stock.md` §3b)

- **Title:** `Draft and send the letter`. This name is proposed. Change it at approval if you want another, because a stock title is permanent once shipped.
- **Intent:** `Draft this letter, send it to its recipients, and see it through to a reply.`
- **Steps.** † marks a step the save omits when the practitioner's request already rules it out:
  1. `Frame the letter: real audience, purpose as an outcome, fit with the goal, capacity and register, without prejudice, delivery method, copies, enclosures, what it must not say`
  2. `Source or attribute each fact, and list the gaps`
  3. † `Settle the law: propositions, research jobs, excerpts and note-ups`
  4. `Approve the outline; the scrivener drafts`
  5. `Review: facts traced, tone and audience, risk, counsel's paragraph review, DRAFT label removed`
  6. † `Client approval`
  7. `Finalize: letterhead, enclosures, signature`
  8. `Send the letter to its recipients` (Deliver's text, unchanged)
  9. `Record the letter as sent` (Deliver's text, unchanged)
  10. `Confirm delivery`
  11. † `Acknowledgement received`
  12. † `Follow up on the date the practitioner set, and log the response`
- **Scope:** Deliver's (`filings`, the letter's id) and (`documents`, NULL), plus `Draft the letter`'s (`filing_prose`, NULL) and (`filing_recipients`, NULL).
- **Steps that don't apply.** A † step is omitted at save only on the practitioner's words. A step found not to apply later is set `cancelled` on their words (`set_step`, which exists).
- **No dates.** No step stores or computes a date. Step 12's date is the practitioner's, held by the existing `/task-prioritization` follow-up.

## Changes

**Skill text** (source under `.claude/skills/`):
- `drafting-data/references/jobs-stock.md` §3b:
  - Table row: a letter kind gets the new job alone. `Deliver` stays only for a save under `Availability letter`, and for letters saved before this change.
  - Replace the `Deliver`-alone letter idiom SQL with the new job's SQL.
  - Add the job's text block.
  - Add the new title to the "twelve jobs" exclusion sentence.
- `drafting-data/references/jobs-gate.md:20`: add the title to the SQL exclusion list, before `'Draft the letter'`, so the substring the test asserts survives.
- `draft/references/procedure.md:37` (save first): a letter's save writes the new job, and the saving session takes it, because the practitioner named this letter.
- `draft/references/letters.md` §8:
  - Rewrite the `Deliver` paragraph for the new job.
  - Add one line per phase saying which existing check ticks its step:
    - source-trace pass → step 5
    - the Sent write → steps 8 and 9
    - delivery-checker → step 10
  - Delete the prose the steps now make unnecessary.
- One-line title mentions in:
  - `work/references/dispatch.md:41` (practitioner's own)
  - `work/SKILL.md:22`
  - `draft/references/job-session.md:39`
  - `draft/references/delivery-check.md`
  - `draft/SKILL.md:59` (ban 19 text unchanged in substance)
  - `prepare/SKILL.md:92`

**Server code** (`source/lawyer/mcp/src/submission/forms/`):
- `goal-gate.ts`: add the title to `STOCK_TITLES`. This also covers `take-job.ts` `fixedText()`.
- `sent-write.ts`:
  - **The new title:** stamp only the steps whose text is `Send the letter to its recipients` or `Record the letter as sent`. Complete the job only when every step is resolved, using the resolved test from `step-state.ts` (as `complete-job.ts` uses it). Report it under the existing closed-job result field.
  - **Old `Deliver`:** behaviour unchanged.
  - **Billing anchor (line 184):** `title IN ('Deliver', <new>)`.
- `build-proceeding-board.ts:188`: the new title is `practitioner_own` too.
- `build-work-board.ts:61-62`: unchanged. Those skips stay `Deliver`-only, and the new job is already skipped as practitioner's own.

**Diagram:** update stage 1 ("its Deliver job") and stage 5 ("Deliver job closed") in `docs/diagrams/Built/Letter drafting.html`, with a new commit tag and date.

## Tests

- `.claude/skills/drafting-data/tests/test_migrate_engine.py` `TestLetterStockJobIdioms`:
  - The plain-save block yields the new title and its 12 steps.
  - The Availability block still yields `Deliver`.
  - The jobs-gate substring holds.
- `source/lawyer/mcp/test/sent-write.db.test.mjs`, with new cases for the new title:
  - Only steps 8 and 9 are stamped.
  - The earlier unticked steps stay open.
  - The job stays queued while step 10 or later is open.
  - The job is completed when every remaining step is cancelled or done.
  - The existing `Deliver` cases pass unchanged.
- The board test: the new job shows `dispatch: skip (practitioner's own)` and is left out of the `gate` count.

## Constraints kept

- The scrivener alone words the letter.
- Source-trace (ban 20) and the delivery check (ban 19) are unchanged and only tick steps.
- No deadline is stored.
- Purpose comes from the practitioner.
- The criteria code and the type files are untouched.

## Verification

1. `npm --prefix "$HOME/Git/probanda-dev/source/lawyer/mcp" run build`, then `APPDATA=<scratch> node --test` on the sent-write, recipients-criterion, forms-render-workboard and take-job tests.
2. `python -m pytest -q` on `.claude/skills/drafting-data/tests`, `.claude/skills/draft/tests` and `.claude/skills/shared/scrivener/tests`.
3. `python scripts/build_plugin.py`, then `--check`, then `python scripts/check_plugin.py`, `python scripts/check_layering.py` and `python scripts/check_publishable.py --new-since origin/main`.
4. Commit the source and `plugins/` by pathspec, then pull `--ff-only` and push. No version bump and no dist/ bundle, because /release does those.

## Orchestration

### 0. Honest sizing, and the shape this run uses

This change is small. The plain run cost $3.24 over 61 Opus calls in about 14 minutes. Most of that cost was probably the four large files (`jobs-stock.md` at about 9,400 words, `letters.md` at about 6,300, `sent-write.ts` at about 3,800, and the 950-line `sent-write.db.test.mjs`) being read from cache again on every later Opus call. Orchestration can save only that re-read cost. It pays for it in three ways:

- Each worker builds a fresh prefix. A measured new Sonnet 5.5 session wrote about 56,000 tokens, roughly $0.20.
- The orchestrator re-runs every test itself.
- The orchestrator spends some calls on dispatch and gating.

Expect the result to be roughly break-even. One session is a reasonable choice for a change this size. To still test the idea, this run uses the smallest useful orchestration:

- two Sonnet workers on disjoint path sets, run in parallel;
- the Opus orchestrator does the gate, the build, the integration check and the commit.

No verifier agent is used. The plan's checks are all deterministic, so the gate covers them (rule 11).

Start in a fresh session. The plan is the only primary source. No run file is kept, because the run is short and the orchestrator's context stays small (rule 14 is for long runs). If a compaction does happen, write `<scratchpad>/letter-run.md` from that point on, recording slice status and check results.

**Worktree.** Create the worktree from `4f0251aa` on branch `exp/letter-orchestrated`, with `git -C`. The hook bans `cd` and `&&`. This plan file lives in the first run's worktree (`probanda-dev-letter-plain`), which also holds that run's finished answer: never read or brief anything there except this plan file. Give this plan file's absolute path to each worker as the one file it may read outside its own worktree.

### 1. Slices

Both workers are `general-purpose` agents, with `model: sonnet` set on each dispatch (rule 12). Launch both in one message with `run_in_background: true`, then wait for both notifications without polling. Count the returns against the two dispatches before going on (rule 10).

| Slice | Plan part | Paths it owns (relative to the new worktree) | Model | Starts after |
|---|---|---|---|---|
| A: skill text and diagram | "Changes": Skill text, all bullets. "Diagram". "Tests": first bullet (`TestLetterStockJobIdioms`) | `.claude/skills/drafting-data/references/jobs-stock.md`, `.claude/skills/drafting-data/references/jobs-gate.md`, `.claude/skills/drafting-data/tests/test_migrate_engine.py`, `.claude/skills/draft/references/procedure.md`, `.claude/skills/draft/references/letters.md`, `.claude/skills/draft/references/job-session.md`, `.claude/skills/draft/references/delivery-check.md`, `.claude/skills/draft/SKILL.md`, `.claude/skills/work/references/dispatch.md`, `.claude/skills/work/SKILL.md`, `.claude/skills/prepare/SKILL.md`, `docs/diagrams/Built/Letter drafting.html` | sonnet | the start |
| B: server code | "Changes": Server code, all bullets. "Tests": second and third bullets | `source/lawyer/mcp/src/submission/forms/goal-gate.ts`, `.../sent-write.ts`, `.../build-proceeding-board.ts`, `source/lawyer/mcp/test/sent-write.db.test.mjs`, the board test (most likely `source/lawyer/mcp/test/forms-render-workboard.db.test.mjs`; B confirms by searching for `practitioner_own`), plus the mcp build output | sonnet | the start, in parallel with A |

Why it is split this way:

- **The split follows the test boundary.** The Python test asserts the SQL text in `jobs-stock.md` and `jobs-gate.md`, so it belongs with A. The node tests exercise the TypeScript, so they belong with B. Each worker can then run and fix its own tests without the other.
- **Running in parallel is safe.** The path sets do not overlap. The one shared decision is the title string and the step texts, and the plan fixes both word for word (§"The job"). Neither worker needs the other's output.
- **Sonnet fits both slices.** A is exactly specified prose and SQL. B is three small edits plus test cases, and fits one fresh context. Neither is a long tool-driven run. Writing code on Sonnet is allowed; only the cheap tier (Haiku) is barred from it (rule 12).
- **Two workers, not more.** Splitting A into "jobs-stock" and "mentions", or B into "code" and "tests", would add prefix cost without removing any re-reads, because each half would read the same large file.

### 2. What every worker brief contains (rules 13, P02)

- **Goal and paths, not pasted text.** Give the plan's absolute path, the plan parts this slice covers, the new worktree's root and the path set from the table. The worker edits nothing outside its path set. A path outside the worktree is read only if it is the plan file.
- **Fixed text.** The title `Draft and send the letter` and the 12 step texts are used exactly as the plan writes them, including the "Deliver's text, unchanged" steps 8 and 9. B matches steps by text, so a reworded step breaks B's stamping.
- **Out of scope.** The criteria code, the type files, `build-work-board.ts` and the other slice's paths. No version bump, no `dist/` bundle, no `/release`.
- **Prohibitions, with reasons:**
  - Never run `scripts/build_plugin.py`. It rewrites each `plugins/<plugin>/` folder wholesale, and the orchestrator runs it once after both slices.
  - Do not commit. Two workers committing in one worktree at once can race on the git index, and the orchestrator commits source and `plugins/` together, as the experiment requires.
  - Use the new worktree's own `source/lawyer/mcp` for npm, never `$HOME/Git/probanda-dev`. Its `node_modules` is a junction to the main checkout, so do not reinstall.
- **The hook's rules.** The hook also runs inside workers, so put its rules in the brief:
  - Each command is one Bash call, with no `&&` and no `cd`.
  - Name each test file by path; only files changed in the last 24 hours will run.
  - Put no redirect such as `2>&1` on the runner line.
  - A: `python -m pytest -q <worktree>/.claude/skills/drafting-data/tests/test_migrate_engine.py`.
  - B: `npm --prefix <worktree>/source/lawyer/mcp run build`, then `node --test` on its two changed test files, with `APPDATA` set to a scratch folder.
- **Stop rules.**
  - A question the plan does not settle comes back as a proposal and is not decided by the worker.
  - After two failed attempts at its own tests, the worker returns `status: blocked` with the failing test names.
- **Return.**
  - First line `status: done|blocked`.
  - Then the files changed, each test file with its pass and fail counts, and any proposals.
  - Last line `end:`.
  - Under about 800 tokens. Never paste test output.
- **On failure.**
  - Unfinished work is resumed with SendMessage.
  - A retry after a failed gate goes to a fresh worker, briefed only with the plan part and the failing check (rule 17). A second failure escalates that fresh worker to `opus`.

### 3. What the main session does itself

- **Does not read the source files.** The orchestrator reads only the plan and the workers' returns (rule 13). Reading the source files here would bring back the re-read cost the run is testing.
- **Integration check.** Run `git -C <worktree> diff --name-only` and confirm every changed path falls in A's or B's set (rule 10). A stray path stops the run.
- **Gate.** Run the plan's Verification steps 1 to 3 as written, each command as its own Bash call under the hook's rules. Do not wrap them in a script, because a wrapper would get around the hook's per-command check.
  - Step 1's node tests: `recipients-criterion` and `take-job` run only if the hook allows them, meaning they changed in the last 24 hours. Record any the hook refuses as "not run (hook)", as the first run had to.
  - Look at the output only when a check fails. Any failure stops the run and goes to a fresh worker as in §2. A worker's report is never the completion check (rule 11).
- **Commit.** Commit the source changes and the rebuilt `plugins/` by explicit pathspec on `exp/letter-orchestrated`. Do not pull, do not push to main and do not run `/release`.
- **Report.** List each test with its counts, the build and check results, the commit SHA, any worker proposals, and anything not verified.

### 4. Context flow

| Context | Started by | Loads | Receives | Decides | Returns | Cannot see | Where |
|---|---|---|---|---|---|---|---|
| Orchestrator (Opus 5.5) | Brahm, fresh session | CLAUDE.md, the plan | two returns, one-line check results | slice order, gate pass or fail, retry or escalate, commit contents | the report | source contents, worker transcripts | device |
| A (Sonnet) | orchestrator, background | CLAUDE.md, the plan, A's path set | brief: plan parts, paths, fixed text, hook rules, return contract | how to word each edit within the plan's fixed text; the pytest fixes | status, files, pytest counts, proposals, `end:` | B's work, the first run's worktree, the conversation | device |
| B (Sonnet) | orchestrator, background | CLAUDE.md, the plan, B's path set, `step-state.ts` and `complete-job.ts` for the resolved test | brief as for A, with B's paths and test commands | how to implement the stamping and completion rule; the test cases | status, files, node test counts, proposals, `end:` | A's work, the first run's worktree, the conversation | device |
