---
description: Cloud only. File every new Suggestion Box entry as a `suggestion` + `needs-triage` issue, once each, and close the issue of each withdrawn one; opening the issue starts /triage-issue, which judges it.
---

# /intake-suggestions

Run unattended by the "Suggestion Box intake" cloud task, which the Suggestion Box's save function starts each time a suggestion is saved, and which also runs daily as a backstop. Only one run works at a time, under the intake lock (`docs/agents/issue-tracker.md`, **Intake lock**). Intake only detects, files and closes withdrawn suggestions' issues: it makes no judgement. Opening the issue fires the "Triage new issues" task, and `/triage-issue` (`.claude/commands/triage-issue.md`) plans and judges it like any other issue.

The cloud does not load Brahm's own global rules, so these hold for the whole run:

- Change no file in the repo and push nothing. The only writes are new issues and each one's number recorded on its suggestion, and, for a withdrawn suggestion, its issue's `withdrawn` label, one closing comment and its close (step 3).
- Nothing filed names a person, entity, matter or account: replace any such name with its role, such as `[client]` or `[opposing counsel]`. Never mention Claude or Anthropic in an issue.
- Nobody answers a permission prompt, so never cause one. Read and search files with the Read, Grep and Glob tools, not shell commands.
- Reach the Suggestion Box only by the calls in `.claude/commands/triage-issue.md` ("Suggestion Box calls").

## GitHub calls

`gh issue` is refused in the cloud: use REST with `curl` through the sandbox proxy, as `docs/agents/issue-tracker.md` ("Cloud sandbox route") describes, at `https://api.github.com/repos/Mharbulous/probanda-dev/...`. The proxy carries the credential, so never look up, echo or pass a token. Every write needs `-H Content-Type:application/json`.

## 1. List

Take the intake lock (**Intake lock**, Take). If it is held, stop and report `Intake lock held`: the holder takes every new row. Then list submitted suggestions (**List submitted**). If the request is refused (a 401 or 403, or a blocked host), stop and report that the cloud environment lacks the Suggestion Box network secret or network access.

## 2. File

List every issue labelled `suggestion`, open and closed (`GET /issues?labels=suggestion&state=all&per_page=100`, every page). For each `submitted` row, oldest first, with no `issue_number` and whose `Suggestion <suggestion_id>` line no listed issue body holds, refresh the intake lock and `POST /issues` with the labels `["suggestion","needs-triage","<lane>"]`, where the lane is `lane:user` for source `user` or `assisted` and `lane:ai` for source `llm` (`docs/agents/issue-tracker.md`, **Implementer lock**, on lanes), the title `Suggestion: <a short paraphrase of what it asks for>`, and this body:

```markdown
## Suggestion

**In short:** <the pain point, paraphrased in one or two lines>

**Items:** <the number of items>, each paraphrased in one line, numbered as in the record.

**Context lines:** <the number of constraint and evidence lines> · **Mockup:** <yes or no> · **Specification:** <yes or no>

**Skill:** <skill or "none named"> · **Plugin version:** <plugin_version> · **Source:** <source> · **Origin:** <origin or "not recorded">

The submitted text is read from the Suggestion Box by this id, never from this issue.

Suggestion <suggestion_id>
```

The title and body paraphrase and never quote the submitted text (design decision 16): pushed history is never rewritten, and a practitioner may withdraw the suggestion. Write the title and body to a file outside the checkout, save the row as JSON beside it, and run `python scripts/check_verbatim.py --suggestion <row.json> <file>`. On a failure, reword the located line in your own words and run it again. Never file a body the check fails. Delete both files once the issue is filed.

Immediately after `POST /issues` returns the number `<n>`, record it on the suggestion: function `suggestion-set-status`, body `{"suggestion_id":"<id>","issue_number":<n>}` (`.claude/commands/triage-issue.md`, **Record the issue**). It changes no status.

A row that already has an issue, by its `issue_number` or by an issue body holding its `Suggestion` line, is left alone: its suggestion stays `submitted` until triage opens it for review. When only an issue body holds the line, record that issue's number on it as above.

## 3. Withdrawals

A practitioner who withdraws a suggestion (design decision 16) leaves, once intake has recorded its issue, a tombstone: a row holding only its id, its issue number and the status `withdrawn`. A withdrawal before intake recorded an issue deleted the row, and no issue exists, so there is nothing to do for it. Derived records paraphrase (step 2), so nothing else needs purging.

Refresh the intake lock. List the tombstones (**List withdrawn** in `.claude/commands/triage-issue.md`, "Suggestion Box calls") and save the reply to a file outside the checkout. List every `suggestion` issue, open and closed, again (as in step 2, every page) and save it to a file beside it. Run `python scripts/withdrawals.py --rows <reply file> --issues <issues file>`. Exit 2: report its message, write nothing, and go to step 4. Otherwise, for each entry of its `actions`, in order:

1. When `comment` is true, `POST /issues/<n>/comments` with the script's `comment` as the body, word for word. It says only that the sender withdrew the suggestion; add nothing to it, and never quote or paraphrase the suggestion.
2. When `add_label` is true, `POST /issues/<n>/labels` with `{"labels":["withdrawn"]}`. If it fails because the label does not exist, create it once with `POST /labels` and the script's `label` object, then add it.
3. When `close` is true, `PATCH /issues/<n>` with `{"state":"closed","state_reason":"not_planned"}`.

Leave every other label as it is: `withdrawn` alone takes the issue out of every queue (`scripts/choose_issue.py`, `/triage-issue`, `/suggestion-triage`), and an implementer holding a claim on it stops before it pushes. Entries under `done` are already closed and labelled. Report each entry under `unmatched` (a tombstone whose issue the list does not hold) with its id and issue number, and write nothing for it.

## 4. Release and catch up

Release the intake lock (**Intake lock**, Release). Then list submitted suggestions once more. If an unfiled one is left, take the lock again and go back to step 2.

Then, for each open issue labelled both `suggestion` and `needs-triage`, and not `withdrawn`, that was opened more than an hour ago, run `/triage-issue <n>`, then `/implement-suggestions` once if any of them left an issue `ready-for-agent` + `cloud`. This catches a suggestion whose triage never started.

## 5. Report

Each suggestion filed with its issue number, each one skipped as already filed, each issue closed or labelled as withdrawn and each unmatched tombstone, and what the catch-up triaged.
