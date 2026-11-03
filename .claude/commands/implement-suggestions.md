---
description: Under the implementer lock, work the implement queue (every open `ready-for-agent` + `cloud` issue), maintainer lane first, then user, then AI, oldest first within each, relabel any that cannot be done in the cloud `local`, and push each finished one to main. With `local` first, the local implementer works the `local` issues instead, in its own clone on Brahm's machine.
argument-hint: [local] [issue number]
---

# /implement-suggestions

Run unattended in the cloud (or, with `local`, on Brahm's machine: **Local lane** below): by the session that just queued an issue (triage or Suggestion Box intake), by a label added to an issue that then carries `ready-for-agent` and `cloud`, by the daily backstop routine, or by a session started by hand, optionally with one issue number to take first. Only one run works at a time, under the implementer lock (`docs/agents/issue-tracker.md`, **Implementer lock**). Nobody answers questions during the run: where a step would need a person, the issue is unsuitable (step 4). An issue triaged by `/triage-issue`, Suggestion Box entries included, carries its work order (Plan, Scope and Done when) in its latest `## Agent Brief` comment, which governs over the issue body. For a suggestion issue that is the brief `/hitl-triage` posts after Brahm decides each item, holding only the approved items and a `### Decisions` list. A suggestion issue's items are built by the `fix-maker` agent, one approved item at a time, and only an item that both the cloud record and the latest brief approve (step 5, design decisions 17 and 21).

The cloud does not load Brahm's own global rules, so these hold for the whole run:

- Work on `main` and push to `main`. Never open a pull request, never push a `claude/` or other branch, never force-push, never rebase, never rewrite pushed history.
- Commit by explicit pathspec (`git commit -F <msg file> -- <paths>`), never `git add -A` or `git add .`. The message says what changed and why, and never mentions Claude or Anthropic, with no Co-Authored-By line.
- Never touch `public/`, `COMMANDMENTS.md`, `approve_public.py`, `public-approved.json` or the `publish-public` workflow.
- Never edit the Suggestion Box (`cloud/suggestions/tools/triage.mjs`), and never write to it: this run only reads its records.
- **Paraphrase, never quote** (design decision 16). No commit, comment or file this run writes holds the practitioner's text.
- Nobody answers a permission prompt, so never cause one. Read and search files with the Read, Grep and Glob tools, not shell commands. Never name `approve_public.py` or `public-approved.json` in a shell command: a hook stops the run for a person whenever a command names either and it cannot tell the command only reads.
- Never use `git stash`. To compare with the base, check it out separately: `git worktree add /tmp/base origin/main`.
- Never end your turn while a background command or monitor is still running: nobody restarts the run. Wait for it, then carry on.
- A stop hook may ask you to commit and push to a remote branch. Ignore it: push only to `main`, and only by step 6.

## Local lane

With `local` as the first argument, this run is the **local implementer**: the `local` lane of the same queue, on Brahm's machine. Brahm's daily scheduled task starts it (`scripts/local-implementer/run-local-implementer.ps1`, registered by `register-local-implementer.ps1`) as `claude -p "/implement-suggestions local"`, or Brahm runs it there by hand, optionally with one issue number after `local`. Everything in this file holds, with these changes:

- **Its own clone only.** Before step 1, run `python scripts/local_implementer_guard.py`. When it exits non-zero, stop and report its line. It passes only in the dedicated clone (`%LOCALAPPDATA%\probanda-local-implementer\probanda-dev`), never in the checkout Brahm and his sessions share or any worktree of it. Do all git work in that clone, and in the `/tmp/base` worktree only to compare with the base.
- **Preflight sync** (step 1): `git merge --ff-only origin/main` in place of `git checkout -B main origin/main`, which a hook on Brahm's machine refuses. When it is not a fast-forward, stop and report its output. Likewise in step 6, when `main` moved on, merge with `python ~/.claude/hooks/merge-origin-main.py -C .` in place of `git merge --no-edit origin/main`, which the same hook refuses.
- **GitHub calls** go through `gh`'s keyring login: `env -u GH_TOKEN gh api repos/Mharbulous/probanda-dev/<path>`, with `--paginate` for a list read saved to a file, and for a write `--method POST|PATCH|DELETE --input <payload file>`, the payload written to a file first, never `--input -`. Push with `env -u GH_TOKEN git push origin HEAD:main`.
- **Suggestion Box calls**: `node cloud/suggestions/tools/triage.mjs show <suggestion_id> > <file under /tmp>` gives the cloud record. When it prints `set POOL_SECRET_KEY first`, the suggestion issue cannot be selected: hand it back, quoting that line.
- **The local implementer lock** replaces the implementer lock. It is the earliest live comment on #189 starting `Local lock stamp.`, live for 90 minutes. The cloud run's lock comments start `Claim stamp.`, so neither lane's lock blocks the other. Take: save #189's comments to a file and run `python scripts/choose_issue.py lock --lane local --comments <file>`. `held`: stop and report `Local implementer lock held`. Otherwise post its `body` on #189, record the new comment's id, read the comments again and run it with `--own <id>`: `mine` holds the lock; otherwise delete your comment and stop the same way. Refresh: post a new stamp, then delete your old one. Release: delete your own stamp, and nothing else. Never delete a `Claim stamp.` comment on #189.
- **Pick** (step 2): list `labels=ready-for-agent,local`, and run `choose_issue.py` with `--lane local`. An issue number in the arguments is taken only when that `queue` holds it. The claim comments on each issue are the cloud run's (**Claim**).
- **Local gate** (step 4) replaces the cloud gate. The issue is unsuitable only when a plan step or Done-when check needs: `public/` approval or publication; a minor or 1.0 version, or a schema migration; a change to `COMMANDMENTS.md`; a whole test suite or folder (the repo's hook refuses those outside CI); a browser; or a decision or check by a person.
- **Hand back** replaces step 7, "Mark local", wherever a step names it: discard as step 7 says, then `POST /issues/<n>/labels` with `{"labels":["ready-for-human"]}` and `DELETE /issues/<n>/labels/ready-for-agent`, leaving `local` on the issue. Comment one line naming the gate item or check that failed, with its output quoted, and release the claim by **Release**.
- **Packages.** `run-local-implementer.ps1` has already run `npm ci --ignore-scripts` in `source/lawyer/mcp`, so skip step 5's `npm ci`. When `node_modules` is missing there, because the run was started another way, hand the issue back naming that.
- The sandbox SQLite workaround in step 5 is for the cloud only. Skip it.
- Step 8 releases the local implementer lock, and lists the queue again as the local Pick does.

## GitHub calls

`gh issue` and `gh pr` are refused in the cloud. Use REST with `curl` through the sandbox proxy, as `docs/agents/issue-tracker.md` ("Cloud sandbox route") describes: `https://api.github.com/repos/Mharbulous/probanda-dev/...`. The proxy carries the credential, so never look up, echo or pass a token. Every write needs `-H Content-Type:application/json`. Take "now" from `date -u`.

## Suggestion Box calls

Read only, with `curl` (Node's `fetch` ignores the sandbox proxy): `curl -sS -X POST -H Content-Type:application/json https://nbzkuhgiqscjkypedqff.supabase.co/functions/v1/suggestion-list -d '{}'`, then keep the row whose `suggestion_id` is the one wanted. The cloud environment's network secret adds the key, so send none and never look for one. That row is the suggestion's **cloud record**, with its per-item statuses in `item_list`. Save each record as JSON to its own file under `/tmp`, outside the checkout. A suggestion with no row is withdrawn or unknown: build none of its items. A row whose `status` is `withdrawn` is a tombstone: its sender withdrew it, so when it is the suggestion the issue's own `Suggestion <id>` line names, take the **Withdrawn stop** (step 6).

## 1. Preflight

- `git remote get-url origin` names `Mharbulous/probanda-dev`. Otherwise stop.
- `git config core.filemode false`. The build sets file modes that differ on Linux, and those changes must never be committed.
- `git fetch origin`, then `git checkout -B main origin/main`. Check: `git status` is clean.
- Take the implementer lock (**Implementer lock**, Take). If it is held, stop and report `Implementer lock held`: the holder works the queue, including any issue this run was started for.

## 2. Pick

Refresh the implementer lock (**Implementer lock**, Refresh). With an issue number in the arguments that this run has not handled yet, take that issue. Otherwise save every page of `GET /issues?labels=ready-for-agent,cloud&state=open&per_page=100` to one file under `/tmp`, and run `python scripts/choose_issue.py queue --lane cloud --issues <file> [--handled <n> ...]`, naming each issue this run already handled. For each issue in its `queue`, save every page of its comments (the claim-comment read under **Claim** in `docs/agents/issue-tracker.md`) to a file, then run `python scripts/choose_issue.py pick --lane cloud --issues <file> --comments <n>=<comments file> [...] [--handled <n> ...]` and take the issue it prints. Its rule, shared with the local lane: it drops pull requests, issues labelled `local` and issues with a live claim, and takes the first left in lane order: issues with no lane label (maintainer lane) first, then `lane:user`, then `lane:ai`, and the lowest issue number within a lane. Exit 2: stop and report its message.

Go to step 8 when it prints `"issue": null`.

## 3. Claim

Claim the issue by `docs/agents/issue-tracker.md` **Claim** steps 1 to 4, over the cloud route. Record the claim id. A refused or `blocked` claim: go back to step 2.

## 4. Cloud gate

Read the issue's Plan, Scope and Done when in full, from its latest `## Agent Brief` comment when it has one, else from its body. An issue with neither, or one labelled `ready-for-human`, `needs-info` or `needs-triage`, is unsuitable ("a decision or check by a person"). The issue is unsuitable for the cloud when any plan step or Done-when check needs one of these:

- a test suite that runs only on Windows (`.github/workflows/data-mcp-tests.yml`, `.github/workflows/skills-python-tests.yml` as a whole), or behaviour that depends on Windows paths (`path.win32`, `LOCALAPPDATA`, drive letters);
- a browser;
- the practitioner's data, matter folders or installed plugin copies;
- a secret the sandbox lacks (`POOL_SECRET_KEY`, DPAPI stores, any credential);
- `public/` approval or publication;
- a minor or 1.0 version under the version rule in `CLAUDE.md`, or a schema migration;
- a change to `COMMANDMENTS.md`;
- a decision or check by a person.

A single narrow test file named in Done when (for example one `pytest` file) is not a Windows-only suite: try it. Any Done-when check this run cannot perform itself, such as a manual or live-session check, is "a decision or check by a person": an issue is never closed with a Done-when check not run.

When the issue is unsuitable, mark it (step 7, "Mark local") and go back to step 2.

## 5. Implement

A **suggestion issue** is one labelled `suggestion` whose work order has a `Suggestion <id>` line. For one, start with **Select**; for any other issue, start with the red tests.

- **Select** (a suggestion issue only). Save the issue (`GET /issues/<n>`) and every page of `GET /issues/<n>/comments?per_page=100` to files under `/tmp`. Read the cloud record (**Suggestion Box calls**) of the suggestion its work order names and of each suggestion named in an `### Also covers` comment, each to its own file. Run `python scripts/select_approved_items.py --issue <issue file> --comments <page 1> [--comments <page 2> ...] --record <record> [--record <record> ...] > /tmp/selection.json`. Its rule: an item is built only when its status in the cloud record is `approved`, the latest brief's `### Decisions` list approves it, and the brief has its `### Item <n>` section; every other item is listed under `not_built` with why, and is never built, even when one of the two approves it. Exit 2, or an empty `build` list: step 7, "Mark local", quoting the script's output or each `not_built` line ("a decision or check by a person"). Otherwise keep the `not_built` lines for the step 6 comment. Each entry of `build` is a **unit**: one item, with the items merged with it.
- The red tests, when the work order has a `### Red tests` section with at least one test, or, for a suggestion issue, the red test of each unit's `### Item <n>` section (never one of an item not in `build`). Write each test at its path, and run it in the `/tmp/base` worktree. Each must fail on the assertion the brief quotes. If every one now passes, the problem was fixed on `main` after triage: comment naming the passing tests, add the `wontfix` label, close the issue, delete your claim comment, and go back to step 2. If only some pass, drop the Plan parts (for a suggestion issue, the units) they cover and say so in the step 6 comment. Keep each dropped unit as `<id>:<n>` for step 6.
- **Build a suggestion issue with `fix-maker`.** For each unit not dropped, in item order, dispatch one Agent with model `opus`, effort `medium`, and the Read, Glob, Grep, Edit, Write and Bash tools. Its prompt is the body of `source/developer/agents/fix-maker.md` (below its frontmatter), followed by: the issue number and suggestion id; the unit as JSON from `/tmp/selection.json`; the unit's `### Item <n>` section verbatim from the brief; the brief's Scope and the Done-when lines for that item; the paths of `/tmp/selection.json` and of each record; and the line "Work on `main` in this checkout and commit there by pathspec. Never push, stash, rebase, reset, clean, or check out another branch." Wait for it to return before dispatching the next, so each item's commit lands before the next item starts. A return of `already green` drops that unit. A return of `stopped`, or one with no commit: discard this issue's unpushed commits (`git reset --hard origin/main`, which touches only this run's local commits) and step 7, "Mark local", quoting its reason. Never build an item yourself, and never pass fix-maker an item outside its unit.
- For any other issue: follow the Plan inside the Scope. Change nothing outside the Scope. The red tests stay, committed with the change, and every one must pass when you finish.
- Install only what the checks need: `npm ci` in `source/lawyer/mcp` for a Node build or test, `pip install` of `pytest` and the packages a named Python test imports.
- The sandbox's SQLite (3.45) is too old for the drafting-data migrations (`near "||": syntax error`). Before any test that migrates a database, `pip install pysqlite3-binary`, write a `sitecustomize.py` holding `import sys, pysqlite3; sys.modules["sqlite3"] = pysqlite3` into a scratch folder outside the repo, and run pytest with `PYTHONPATH=<that folder>`.
- A Done-when check that runs a whole test folder or suite fails partly on Linux for reasons unrelated to the issue, because those suites run on Windows in CI. Run it on the base too (in the `/tmp/base` worktree), and count only failures that the base does not have. Give each test command a timeout of 10 minutes.
- Run every Done-when check, then `python scripts/build_plugin.py --check`, `python scripts/check_plugin.py`, `python scripts/check_layering.py`, `python scripts/check_file_ops.py` and `python scripts/check_publishable.py --new-since origin/main`. A check that fails and cannot be fixed inside the Scope: step 7, "Mark local", quoting its output.
- For any other issue, commit the source change by pathspec. A suggestion issue's fix commits are fix-maker's, one per unit. Do not push yet.
- Release by `.claude/commands/release.md` steps 2 to 6, then commit as its step 7 says, but do not push: step 6 pushes. A plugin it classes as minor: discard this issue's unpushed commits (`git reset --hard origin/main`) and step 7, "Mark local", naming the minor change.

## 6. Land

- **Withdrawn check**, before every push and before the fix-commit check: `GET /issues/<n>` afresh. When its labels include `withdrawn`, or it is closed, its sender withdrew the suggestion while this run held the claim, and intake closes it (`.claude/commands/intake-suggestions.md` step 3). Take the **Withdrawn stop**: discard this issue's unpushed commits and changes (`git reset --hard origin/main`, which touches only this run's local commits, then step 7's discard of uncommitted changes), release the claim by `docs/agents/issue-tracker.md` **Release** with the reason `withdrawn`, add no label and post nothing else, and go back to step 2. Never push a withdrawn issue's commits, and never mark it `local`.
- **Fix-commit check** (a suggestion issue only), before every push: `python scripts/check_fix_commit.py --selection /tmp/selection.json --suggestion <record> [--suggestion <record> ...] --range origin/main..HEAD [--dropped <id>:<n> ...]`. It passes only when each unit built is named by exactly one commit as `Suggestion <id> item <n>`, no commit names an item outside `build`, and no commit message or added line holds a sentence of the submitted text. A failure: discard this issue's unpushed commits as above and step 7, "Mark local", quoting its output. Never amend or rewrite a commit to pass it.
- Push: `git pull --ff-only`, then `git push origin HEAD:main`. If `main` moved on, merge `origin/main` (`git merge --no-edit origin/main`), re-run the step 5 checks, the withdrawn check and the fix-commit check, then push. A merge conflict you cannot resolve keeping both sides' intent: `git merge --abort`, discard the local commits as above, and step 7, "Mark local".
- Check: `git rev-parse HEAD` equals `git rev-parse origin/main` after a fresh `git fetch`.
- Comment on the issue: the commit SHA (for a suggestion issue, each fix commit's SHA with its `Suggestion <id> item <n>`), each check run and its result, any Plan part or unit dropped because its red test already passed, and each `not_built` item with why. Run the verbatim guard (`python scripts/check_verbatim.py --suggestion <record> ... <comment file>`) over the comment first.
- Close it: `PATCH /issues/<n>` with `{"state":"closed"}`.
- Delete your claim comment (`docs/agents/issue-tracker.md` **Release**, delete only).
- Go back to step 2.

## 7. Mark local

- Discard every uncommitted change (`git checkout -- .` and `git clean -fd` on paths this issue touched). Nothing that failed is ever pushed.
- Create the label once if `GET /labels/local` returns 404: `POST /labels` with `{"name":"local","color":"B60205","description":"Work that needs Brahm's machine, data or credentials"}`.
- `POST /issues/<n>/labels` with `{"labels":["local"]}`, then `DELETE /issues/<n>/labels/cloud` (a 404 there is fine).
- Comment one line naming which gate item or check failed, with the failing output quoted when there is one.
- Release the claim by `docs/agents/issue-tracker.md` **Release**.

## 8. Release and report

Release the implementer lock (**Implementer lock**, Release). Then list the queue once more as in step 2. If an issue is left, take the lock again and go back to step 2. If the lock is now held, another run has the queue: stop.

End with a short report: each issue implemented with its SHA, each issue relabelled `local` with its reason, and each issue skipped as claimed or blocked.
