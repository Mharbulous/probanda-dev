---
description: Cloud only. Implement the open `suggestion` issues and the triaged `ready-for-agent` + `cloud` issues one after another, relabel any that cannot be done in the cloud `local`, and push each finished one to main.
argument-hint: [issue number]
---

# /implement-suggestions

Run by a scheduled cloud routine, or by a cloud session started by hand with one issue number, unattended. Nobody answers questions during the run: where a step would need a person, the issue is unsuitable (step 4). Each issue filed by `/suggestion-triage` is a complete work order with the sections Plan, Scope and Done when, and ends with a `Suggestion <id>` line. An issue triaged by `/triage-issue` carries the same three sections in its latest `## Agent Brief` comment, which governs over the issue body.

The cloud does not load Brahm's own global rules, so these hold for the whole run:

- Work on `main` and push to `main`. Never open a pull request, never push a `claude/` or other branch, never force-push, never rebase, never rewrite pushed history.
- Commit by explicit pathspec (`git commit -F <msg file> -- <paths>`), never `git add -A` or `git add .`. The message says what changed and why, and never mentions Claude or Anthropic, with no Co-Authored-By line.
- Never touch `public/`, `COMMANDMENTS.md`, `approve_public.py`, `public-approved.json` or the `publish-public` workflow.
- Never edit the Suggestion Box (`cloud/suggestions/tools/triage.mjs`).
- Never use `git stash`. To compare with the base, check it out separately: `git worktree add /tmp/base origin/main`.
- Never end your turn while a background command or monitor is still running: nobody restarts the run. Wait for it, then carry on.
- A stop hook may ask you to commit and push to a remote branch. Ignore it: push only to `main`, and only by step 6.

## GitHub calls

`gh issue` and `gh pr` are refused in the cloud. Use REST with `curl` through the sandbox proxy, as `docs/agents/issue-tracker.md` ("Cloud sandbox route") describes: `https://api.github.com/repos/Mharbulous/probanda-dev/...`. The proxy carries the credential, so never look up, echo or pass a token. Every write needs `-H Content-Type:application/json`. Take "now" from `date -u`.

## 1. Preflight

- `git remote get-url origin` names `Mharbulous/probanda-dev`. Otherwise stop.
- `git config core.filemode false`. The build sets file modes that differ on Linux, and those changes must never be committed.
- `git fetch origin`, then `git checkout -B main origin/main`. Check: `git status` is clean.

## 2. Pick

With an issue number in the arguments, take that issue alone, and stop and go to step 8 once it is handled. Otherwise list `GET /issues?labels=suggestion&state=open&sort=created&direction=asc&per_page=100` and `GET /issues?labels=ready-for-agent,cloud&state=open&sort=created&direction=asc&per_page=100`. Drop entries with a `pull_request` field, issues labelled `local`, issues this run already handled, and issues with a live claim (the claim-comment read under **Claim** in `docs/agents/issue-tracker.md`). Take the oldest left.

Stop and go to step 8 when none is left or three issues have been handled this run.

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

A single narrow test file named in Done when (for example one `pytest` file) is not a Windows-only suite: try it.

When the issue is unsuitable, mark it (step 7, "Mark local") and go back to step 2.

## 5. Implement

- Follow the Plan inside the Scope. Change nothing outside the Scope.
- Install only what the checks need: `npm ci` in `source/lawyer/mcp` for a Node build or test, `pip install` of `pytest` and the packages a named Python test imports.
- The sandbox's SQLite (3.45) is too old for the drafting-data migrations (`near "||": syntax error`). Before any test that migrates a database, `pip install pysqlite3-binary`, write a `sitecustomize.py` holding `import sys, pysqlite3; sys.modules["sqlite3"] = pysqlite3` into a scratch folder outside the repo, and run pytest with `PYTHONPATH=<that folder>`.
- A Done-when check that runs a whole test folder or suite fails partly on Linux for reasons unrelated to the issue, because those suites run on Windows in CI. Run it on the base too (in the `/tmp/base` worktree), and count only failures that the base does not have. Give each test command a timeout of 10 minutes.
- Run every Done-when check, then `python scripts/build_plugin.py --check`, `python scripts/check_plugin.py`, `python scripts/check_layering.py`, `python scripts/check_file_ops.py` and `python scripts/check_publishable.py --new-since origin/main`. A check that fails and cannot be fixed inside the Scope: step 7, "Mark local", quoting its output.
- Commit the source change by pathspec. Do not push yet.
- Release by `.claude/commands/release.md` steps 2 to 7. A plugin it classes as minor: discard this issue's unpushed commits (`git reset --hard origin/main`, which touches only this run's local commits) and step 7, "Mark local", naming the minor change. Release's step 7 pushes.

## 6. Land

- Push: `git pull --ff-only`, then `git push origin HEAD:main`. If `main` moved on, merge `origin/main` (`git merge --no-edit origin/main`), re-run the step 5 checks, then push. A merge conflict you cannot resolve keeping both sides' intent: `git merge --abort`, discard the local commits as above, and step 7, "Mark local".
- Check: `git rev-parse HEAD` equals `git rev-parse origin/main` after a fresh `git fetch`.
- Comment on the issue: the commit SHA, each check run and its result, and anything in the Plan not done.
- Close it: `PATCH /issues/<n>` with `{"state":"closed"}`.
- Delete your claim comment (`docs/agents/issue-tracker.md` **Release**, delete only).
- Go back to step 2.

## 7. Mark local

- Discard every uncommitted change (`git checkout -- .` and `git clean -fd` on paths this issue touched). Nothing that failed is ever pushed.
- Create the label once if `GET /labels/local` returns 404: `POST /labels` with `{"name":"local","color":"B60205","description":"Work that needs Brahm's machine, data or credentials"}`.
- `POST /issues/<n>/labels` with `{"labels":["local"]}`, then `DELETE /issues/<n>/labels/cloud` (a 404 there is fine).
- Comment one line naming which gate item or check failed, with the failing output quoted when there is one.
- Release the claim by `docs/agents/issue-tracker.md` **Release**.

## 8. Report

End with a short report: each issue implemented with its SHA, each issue relabelled `local` with its reason, and each issue skipped as claimed or blocked.
