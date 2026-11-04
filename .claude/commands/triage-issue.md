---
description: Cloud or local. Triage one probanda-dev issue unattended, including a Suggestion Box entry filed by /intake-suggestions - verify it, write its work order, and label its category, state and location (cloud or local). A suggestion issue always ends ready-for-human, one open decision per item.
argument-hint: [issue number]
---

# /triage-issue

Triages one issue: the number in the arguments, or, when a GitHub event started the run, the issue in the event payload. With neither, as on the nightly schedule, the run is a **sweep** (below). Nobody answers questions during the run. Where the issue needs a person's decision, that is an outcome (`ready-for-human`), never a reason to stop and ask.

The cloud does not load Brahm's own global rules, so these hold for the whole run:

- Triage commits and pushes nothing, and deletes any test file it wrote to run in step 4. Its only writes are to the issue (one comment and its labels, and for a merged suggestion one comment on the issue it merges into), for a suggestion issue, the suggestion's `under review` status, and in a sweep, the triage lock. Triage never approves or declines an item: only the maintainer does (design decisions 17 and 20). A command the session runs after triage, such as the implementer, follows its own rules.
- Never mention Claude or Anthropic in the comment, and never name a person, entity, matter or account in it.
- **Paraphrase, never quote** (design decision 16). Nothing triage writes to GitHub, and no red test, holds the practitioner's text: describe each item and the pain in your own words and refer to items by number. Before posting any comment, run the verbatim guard over it (step 6).
- Nobody answers a permission prompt, so never cause one. Read and search files with the Read, Grep and Glob tools, not shell commands. Never name `approve_public.py` or `public-approved.json` in a shell command: a hook stops the run for a person whenever a command names either and it cannot tell the command only reads.

## GitHub calls

Locally, use `gh`. In the cloud, `gh issue` is refused: use REST with `curl` through the sandbox proxy, as `docs/agents/issue-tracker.md` ("Cloud sandbox route") describes, at `https://api.github.com/repos/Mharbulous/probanda-dev/...`. The proxy carries the credential, so never look up, echo or pass a token. Every write needs `-H Content-Type:application/json`.

## Suggestion Box calls

In the cloud, use `curl` only: Node's `fetch` ignores the sandbox proxy. Each call is `curl -sS -X POST -H Content-Type:application/json https://nbzkuhgiqscjkypedqff.supabase.co/functions/v1/<function> -d '<body>'`, and the cloud environment's network secret adds the key, so send none and never look for one:

- **List submitted:** function `suggestion-list`, body `{"status":"submitted"}`. The reply's `suggestions` holds the rows, oldest first.
- **List withdrawn:** function `suggestion-list`, body `{"status":"withdrawn"}`. The reply's `suggestions` holds the tombstones: each only its `suggestion_id`, its `issue_number` and the status `withdrawn`. `/intake-suggestions` step 3 closes their issues.
- **Read one:** function `suggestion-list`, body `{}`, then keep the row whose `suggestion_id` is the one wanted. This row is the **cloud record**: the pain point (`body`), the items in order (`item_list`, each with its `item` number and `text`), `context_lines`, `comment`, `origin`, `fingerprint`, `raw_observation`, `environment_facts`, `specification` and `backstop_result`. Save it as JSON to a file outside the checkout (for example under `/tmp`) for the verbatim guard.
- **Record the issue:** function `suggestion-set-status`, body `{"suggestion_id":"<id>","issue_number":<n>}`. It changes no status, and refuses a different issue once one is recorded.
- **Open for review:** function `suggestion-set-status`, body `{"suggestion_id":"<id>","status":"under review","issue_number":<n>}`.

Locally, with `POOL_SECRET_KEY` set, run `node cloud/suggestions/tools/triage.mjs` instead: `list`, `show <suggestion_id>`, `set-issue <suggestion_id> <n>` and `set-review <suggestion_id> <n>`.

Item decisions are not triage's: the maintainer records them through `/hitl-triage`, which calls `triage.mjs set-item`.

## The verbatim guard

`python scripts/check_verbatim.py --suggestion <record.json> [--suggestion <record.json> ...] <file> [<file> ...]` fails (exit 1) when any checked file holds a sentence of a record's submitted text word for word, ignoring case, spacing, line breaks and punctuation, and prints only where. Write each comment, issue body and red test to a file outside the checkout and run the guard over it with the record of every suggestion it concerns. On a failure, reword the located passage in your own words and run it again. Never post or hand on a file the guard fails.

## Sweep

A sweep catches the issues the event route missed.

1. Take the triage lock (`docs/agents/issue-tracker.md`, **Triage lock**, over the route above). When it is held, stop and report that.
2. Save every page of `GET /issues?state=open&per_page=100` to one file outside the checkout, and run `python scripts/choose_issue.py untriaged --issues <file>`. Exit 2: release the lock, and stop and report its message.
3. For each number in its `queue`, in order: refresh the lock, then run steps 1 to 6 on that issue. An issue that stops at step 1 or fails partway is noted, and the sweep goes on to the next.
4. Release the lock. Step 7's report covers each issue triaged, each one stopped at step 1 with why, and each failure.

## 1. Read

`GET /issues/<n>` and every page of `GET /issues/<n>/comments?per_page=100`. Stop without writing anything when the issue:

- is closed or is a pull request;
- carries any `wayfinder:*` label, or its parent carries `wayfinder:map` (the wayfinder skill owns those);
- carries `withdrawn`: its sender withdrew the suggestion, and `/intake-suggestions` closes it. This holds even when the issue is named in the arguments;
- already carries a state label (`ready-for-agent`, `ready-for-human`, `needs-info`, `wontfix`) and was not named in the arguments;
- in a sweep, already carries an `## Agent Brief` comment (**Brief read** in `docs/agents/issue-tracker.md`) and does not carry `needs-triage`: it has been triaged already. An issue with a brief and `needs-triage` was handed back by an implementer: read its latest `Hand-back (` comment, and write a new brief that removes that cause. Keep every `### Decisions` line word for word. When a decision cannot stand, the state is `ready-for-human` with the reason `wrong-rule`.

A **suggestion issue** is one labelled `suggestion` whose body ends with a `Suggestion <suggestion_id>` line. Its body is intake's paraphrase. Read the cloud record by its id (**Read one**): the record, not the issue body, is what step 3 plans. If the Suggestion Box holds no such row, or its status is `withdrawn`, stop and report it, writing nothing. Otherwise open it for review now (**Open for review**, with this issue's number). A refusal because another issue is recorded means the suggestion is filed under that issue: stop and report both numbers.

## 2. Check a suggestion issue for a repeat or a merge

Skip this step for any other issue.

List every `suggestion` issue, open and closed: `GET /issues?labels=suggestion&state=all&per_page=100&page=<k>`, from `k=1` until a page returns fewer than 100, dropping this issue and pull requests. Compare this suggestion's items with each by meaning, not wording, and read the body and latest Agent Brief of each likely match. Then:

- **Merged by fingerprint.** When this record has a `fingerprint` (Probanda noticed it) and an open issue `#m` still labelled `ready-for-human` covers a suggestion whose record has the same fingerprint (plugin, version, skill and kind; read that record by its id), and each of this suggestion's items asks for what one item of `#m` asks for, this issue is merged into `#m` (design decision 3: a triage view over separate records, never one merged record). Post one comment on `#m`, guarded with both records, that opens with `> *This was generated by AI during triage.*` and then `### Also covers`, the line `Suggestion <this suggestion_id>, issue #<n>`, and one line per item, `item <j> = item <k> of Suggestion <#m's suggestion_id>`. Then go to step 6 and write this issue's brief as a merged brief. When any item has no match, it is not merged: treat it as below.
- **Repeat.** Each item that asks for what an earlier issue `#m` already asked for, open or closed, gets the recommendation `decline: already suggested` with the reason "Already suggested", and names `#m` under **Verification**, unless it brings new evidence (a pain point, failure or setup `#m` lacked). Item recommendations from this step stand: step 3 plans only the other items, and when every item is a repeat, skip to step 6.

## 3. Plan a suggestion issue

Skip this step for any other issue.

Dispatch one Agent with model `opus`, effort `high`, and only the Read, Glob and Grep tools. Its prompt is the body of `source/developer/agents/fix-planner.md` (below its frontmatter), followed by the suggestion's id, the issue number, the related issues from step 2 with the items each repeats, and the cloud record as JSON, with `mockup_html` left out. The planner takes the items exactly as the record gives them, and returns, per item, a recommendation, a reason, a check, the check's expected result and, for what it recommends, a plan, and it checks the record's `specification` against the code when there is one.

Run the guard over its return. Check it is complete: every item of the record has its section, in order, none merged or split, each with a check that names a file and a command (or, for `decline: not enough detail` only, the missing detail). When a section is missing or the guard fails, resume the planner once with what is missing; if it still fails, the items left without a check are recorded under **Open decisions** as having none, and why.

Steps 4 to 6 then treat the planner's per-item Plan, Scope and checks as the issue's own: verify them as written, and decide location for them. The planner never decides those.

## 4. Verify

Start with the red tests, so no one plans or builds a change that changes nothing. For a suggestion issue, the checks are the planner's, one per item. For any other issue, they are the work order's Done-when checks. For each:

- **Write** the narrowest test that states it, with invented data and none of the record's text, at the path where the repo's runner finds it (for example `source/lawyer/mcp/test/<name>.test.mjs`, or a skill's `tests/test_<name>.py`), or as one command. Take the facts from the code, not from the issue's wording. Install only what that test needs, as in `.claude/commands/implement-queue.md` step 5, including its SQLite note. Run the guard over a suggestion's red test before running it: the file is posted in step 6 and later committed by the implementer.
- **Run** it against current `main`, and record one result:
  - **Red:** it fails on an assertion that states the check. An import error, a failed build or a missing tool is not red: fix the test, or record it as not run.
  - **Green:** it passes on `main`, so that part needs no change. For a suggestion item, its recommendation becomes `decline: already works as asked`, with the reason "Already works as asked", whatever the planner recommended. For any other issue, drop it from the Plan.
  - **Not run:** it needs Windows, the practitioner's data, a secret, or a person. Say which. For an issue other than a suggestion, a problem that shows only on the practitioner's data is `needs-info`, asking for a reproduction with invented data.

Then read the code, docs and ADRs the issue names, and the project's `GLOSSARY.md` for its terms. Check every factual claim in the issue and the planner's return against the source: counts, paths, line numbers, and what the code does. For a bug, reproduce it where the sandbox can. Search for an existing implementation of the request by its domain concept, not only its wording. Record what held, what was wrong, and the corrected facts.

## 5. Decide

State each decision with a one-line reason.

- **Category:** `bug` or `enhancement`.
- **State**, for a suggestion issue: always `ready-for-human`, with one open decision per item, whatever the recommendations. A suggestion whose red tests all pass, or which repeats an earlier one, is recommended for decline, and the maintainer confirms it; triage never closes a suggestion issue.
- **State**, for any other issue:
  - `wontfix`: already implemented, or the verification shows the problem does not exist, including when every red test came out green.
  - `needs-info`: facts only the reporter holds are missing.
  - `ready-for-human`: only for a reason on the closed list in `docs/agents/issue-tracker.md`, **What needs a person**. Anything else, decide it yourself and record it under `### Decisions` with its reason and the option rejected, so Brahm can override it. Never write a stop rule that hands the issue to a person for a reason not on that list.
  - `ready-for-agent`: an agent can finish it from the work order alone and check its own result: every remaining Done-when check came out red, or was not run only for want of Windows, data or a secret.
- **Location**, for `ready-for-agent` and `ready-for-human` only: `local` when any step or check of the work needs an item in the cloud gate of `.claude/commands/implement-queue.md` (step 4) other than "a decision or check by a person", or when a check names a file whose name holds `approve_public`, because that name stops a cloud run. Otherwise `cloud`. The local lane cannot write under `.claude/` (its gate says so): work that writes there and also needs `local` is `ready-for-human` with the reason `person-only-check`, for an attended session. For a suggestion issue, judge it over the items recommended for approval, or over every item when none is.

## 6. Write

Post one comment that opens with `> *This was generated by AI during triage.*` and then the brief below. Write it to a file first and run `python scripts/check_brief.py <file>`. On a failure, fix what it names and run it again, and never post a brief it fails. For a suggestion issue, also run the guard over the file with the record (and every record it concerns), and post it only once the guard passes.

For an issue other than a suggestion:

```markdown
## Agent Brief

**Category:** … **State:** … **Location:** …, each with its reason.

**Verification:** what held, and each corrected fact.

### Plan
Numbered steps, by behaviour and interface, not by line number.

### Scope
What may change, and what is out of bounds.

### Done when
Each check this run can perform, runnable as a command where possible. Name a test file only when the Plan creates or edits it, because the repo's hook refuses a run of an unchanged file. Never a whole suite or folder, or a scheduled run.

### After landing
Each check only CI can run, such as a whole suite or the next nightly run. These are not Done-when checks: the implementer runs none of them, and a nightly failure files a new issue.

### Red tests
For each red test: its path (inside Scope), the file verbatim in a fenced block, the command, and the one failing assertion line from `main`. For a failing test the hook refuses to run unchanged, the assertion quoted from the nightly run counts as red. For each check not run: why.
```

For `ready-for-human`, add `### Open decisions`, each a concrete question with its options, which Brahm answers through `/hitl-triage`, and after each question a line `Needs a person: <reason>`, by its key on the closed list. For `needs-info`, write the established facts and the questions in place of the brief. For `wontfix`, write why, quoting any green test command, then close the issue.

For a suggestion issue, the brief is grouped by item, so that the maintainer decides each item and `/hitl-triage` can keep only the approved items' sections for the build:

```markdown
## Agent Brief

Suggestion <suggestion_id>

**Category:** … **State:** ready-for-human **Location:** …, each with its reason.

**Verification:** what held, each corrected fact, the specification's check, and each related issue from step 2.

### Item 1
**Item:** the planner's one-line paraphrase.
**Recommendation:** approve | approve part: … | decline: <category>, and **Reason:** the one plain line to record.
**Check:** the test's path and command, and its result on `main` (red, with the one failing assertion line; green; or not run, and why).
**Plan:** for approve and approve part only, numbered steps by behaviour and interface.
**Red test:** for a red result, the file verbatim in a fenced block.

### Item 2
…

### Scope
What may change for the items recommended for approval, and what is out of bounds.

### Done when
Each red item's check as a command, by item number, then the plugin's own checks.

### Open decisions
One per item, in order: `Item <k>: approve or decline? Recommended: <recommendation>, reason "<reason>".`, then the line `Needs a person: suggestion`.
```

A **merged brief** (step 2) is `## Agent Brief`, the `Suggestion <suggestion_id>` line, `**State:** ready-for-human`, the line `Merged by fingerprint into #m: each item is decided with #m's matching item.`, the item mapping, and one open decision per item naming `#m`, each followed by the line `Needs a person: suggestion`. It needs no plan, check or red test of its own.

Set no item status: the maintainer decides each item through `/hitl-triage`. For any other issue, nothing is recorded on the Suggestion Box.

Then set the labels: add the category, the state and, where it applies, the location label, and remove `needs-triage`. Create a missing label with `POST /labels` first: `cloud` (`{"name":"cloud","color":"0E8A16","description":"Work an unattended cloud session can do"}`) or `local` (`{"name":"local","color":"B60205","description":"Work that needs Brahm's machine, data or credentials"}`).

## 7. Report

End with the issue number, the labels applied, the one-line reason for each decision and, for a suggestion issue, each item's recommendation and check result, and that the suggestion is under review.
