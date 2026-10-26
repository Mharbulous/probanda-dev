---
description: Cloud only. File every new Suggestion Box entry as a `suggestion` + `needs-triage` issue, once each; opening the issue starts /triage-issue, which judges it.
---

# /intake-suggestions

Run unattended by the "Suggestion Box intake" cloud task, which the Suggestion Box's save function starts each time a suggestion is saved, and which also runs daily as a backstop. Only one run works at a time, under the intake lock (`docs/agents/issue-tracker.md`, **Intake lock**). Intake only detects and files: it makes no judgement. Opening the issue fires the "Triage new issues" task, and `/triage-issue` (`.claude/commands/triage-issue.md`) plans and judges it like any other issue.

The cloud does not load Brahm's own global rules, so these hold for the whole run:

- Change no file in the repo and push nothing. The only writes are new issues.
- Nothing filed names a person, entity, matter or account: replace any such name with its role, such as `[client]` or `[opposing counsel]`. Never mention Claude or Anthropic in an issue.
- Nobody answers a permission prompt, so never cause one. Read and search files with the Read, Grep and Glob tools, not shell commands.
- Reach the Suggestion Box only by the calls in `.claude/commands/triage-issue.md` ("Suggestion Box calls").

## GitHub calls

`gh issue` is refused in the cloud: use REST with `curl` through the sandbox proxy, as `docs/agents/issue-tracker.md` ("Cloud sandbox route") describes, at `https://api.github.com/repos/Mharbulous/probanda-dev/...`. The proxy carries the credential, so never look up, echo or pass a token. Every write needs `-H Content-Type:application/json`.

## 1. List

Take the intake lock (**Intake lock**, Take). If it is held, stop and report `Intake lock held`: the holder takes every new row. Then list new suggestions. If the request is refused (a 401 or 403, or a blocked host), stop and report that the cloud environment lacks the Suggestion Box network secret or network access.

## 2. File

List every issue labelled `suggestion`, open and closed (`GET /issues?labels=suggestion&state=all&per_page=100`, every page). For each `new` row, oldest first, whose `Suggestion <suggestion_id>` line no listed issue body holds, refresh the intake lock and `POST /issues` with the labels `["suggestion","needs-triage","<lane>"]`, where the lane is `lane:user` for source `user` or `assisted` and `lane:ai` for source `llm` (`docs/agents/issue-tracker.md`, **Implementer lock**, on lanes), the title `Suggestion: <its title>`, and this body:

```markdown
## Suggestion

**Title:** <title>

**Body:** <body>

**Skill:** <skill or "none named"> · **Plugin version:** <plugin_version> · **Source:** <source>

<its items verbatim, and each preview's label, chosen flag and reason, when the row has them>

Suggestion <suggestion_id>
```

A row that already has an issue is left alone: its suggestion stays `new` until triage records its outcome.

## 3. Release and catch up

Release the intake lock (**Intake lock**, Release). Then list new suggestions once more. If an unfiled one is left, take the lock again and go back to step 2.

Then, for each open issue labelled both `suggestion` and `needs-triage` that was opened more than an hour ago, run `/triage-issue <n>`, then `/implement-suggestions` once if any of them left an issue `ready-for-agent` + `cloud`. This catches a suggestion whose triage never started.

## 4. Report

Each suggestion filed with its issue number, each one skipped as already filed, and what the catch-up triaged.
