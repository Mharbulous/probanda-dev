---
description: Cloud or local. Triage one probanda-dev issue unattended, including a Suggestion Box entry filed by /intake-suggestions - verify it, write its work order, and label its category, state and location (cloud or local).
argument-hint: <issue number>
---

# /triage-issue

Triages one issue: the number in the arguments, or, when a GitHub event started the run, the issue in the event payload. Nobody answers questions during the run. Where the issue needs a person's decision, that is an outcome (`ready-for-human`), never a reason to stop and ask.

The cloud does not load Brahm's own global rules, so these hold for the whole run:

- Triage changes no file in the repo and pushes nothing. Its only writes are to the issue (one comment and its labels) and, for a suggestion issue, the suggestion's status. A command the session runs after triage, such as the implementer, follows its own rules.
- Never mention Claude or Anthropic in the comment, and never name a person, entity, matter or account in it.
- Nobody answers a permission prompt, so never cause one. Read and search files with the Read, Grep and Glob tools, not shell commands. Never name `approve_public.py` or `public-approved.json` in a shell command: a hook stops the run for a person whenever a command names either and it cannot tell the command only reads.

## GitHub calls

Locally, use `gh`. In the cloud, `gh issue` is refused: use REST with `curl` through the sandbox proxy, as `docs/agents/issue-tracker.md` ("Cloud sandbox route") describes, at `https://api.github.com/repos/Mharbulous/probanda-dev/...`. The proxy carries the credential, so never look up, echo or pass a token. Every write needs `-H Content-Type:application/json`.

## Suggestion Box calls

In the cloud, use `curl` only: Node's `fetch` ignores the sandbox proxy. Both calls are `curl -sS -X POST -H Content-Type:application/json https://nbzkuhgiqscjkypedqff.supabase.co/functions/v1/<function> -d '<body>'`, and the cloud environment's network secret adds the key, so send none and never look for one:

- **List new:** function `suggestion-list`, body `{"status":"new"}`. The reply's `suggestions` holds the rows, oldest first.
- **Set status:** function `suggestion-set-status`, body `{"suggestion_id":"<id>","status":"<approved|approved in part|rejected>"}`, adding `"issue_number":<n>`. It refuses a second call on the same row.

Locally, run `node cloud/suggestions/tools/triage.mjs set-status <suggestion_id> <status> --issue <n>` instead, with `POOL_SECRET_KEY` set.

## 1. Read

`GET /issues/<n>` and every page of `GET /issues/<n>/comments?per_page=100`. Stop without writing anything when the issue:

- is closed or is a pull request;
- carries any `wayfinder:*` label, or its parent carries `wayfinder:map` (the wayfinder skill owns those);
- already carries a state label (`ready-for-agent`, `ready-for-human`, `needs-info`, `wontfix`) and was not named in the arguments.

A **suggestion issue** is one labelled `suggestion` whose body ends with a `Suggestion <suggestion_id>` line. It holds a practitioner's words, not a plan, so step 2 plans it first.

## 2. Plan a suggestion issue

Skip this step for any other issue.

Dispatch one Agent with model `fable` and only the Read, Glob and Grep tools. Its prompt is the body of `source/developer/agents/suggestion-planner.md` (below its frontmatter), followed by the issue's Suggestion section and its `suggestion_id`. From the planner's TLDR, take the first that fits:

1. "Approve with your adjustments" is marked `(Recommended)`: the work order is the planner's main issue, and the status is `approved` for `Verdict: all` or `approved in part` for `Verdict: some`.
2. "Approve as proposed" is marked `(Recommended)`: the work order is the As proposed issue (the main issue when As proposed is `same as above`), and the status is `approved`.
3. Otherwise, including when doing nothing is marked: the state is `wontfix`, with the planner's reasons, and the status is `rejected`.

Set the suggestion's status at once, with this issue's number. Steps 3 to 5 then treat the planner's Plan, Scope and Done when as the issue's own: verify them as written, and decide state and location for them. The planner never decides those, and an open choice its TLDR leaves is an open decision.

## 3. Verify

Read the code, docs and ADRs the issue names, and the project's `GLOSSARY.md` for its terms. Check every factual claim in the issue against the source: counts, paths, line numbers, and what the code does. For a bug, reproduce it where the sandbox can. Search for an existing implementation of the request by its domain concept, not only its wording. Record what held, what was wrong, and the corrected facts.

## 4. Decide

State each decision with a one-line reason.

- **Category:** `bug` or `enhancement`.
- **State:**
  - `wontfix`: already implemented, or the verification shows the problem does not exist.
  - `needs-info`: facts only the reporter holds are missing.
  - `ready-for-human`: the work needs a design decision, a judgement call, or a check by a person. The issue's own open questions count, as does any proposal the issue itself calls risky.
  - `ready-for-agent`: an agent can finish it from the work order alone and check its own result.
- **Location**, for `ready-for-agent` and `ready-for-human` only: `local` when any step or check of the work needs an item in the cloud gate of `.claude/commands/implement-suggestions.md` (step 4) other than "a decision or check by a person". Otherwise `cloud`.

## 5. Write

Post one comment that opens with `> *This was generated by AI during triage.*` and then:

```markdown
## Agent Brief

**Category:** … **State:** … **Location:** …, each with its reason.

**Verification:** what held, and each corrected fact.

### Plan
Numbered steps, by behaviour and interface, not by line number.

### Scope
What may change, and what is out of bounds.

### Done when
Each check, runnable as a command where possible. Name narrow test files, not whole suites.
```

For `ready-for-human`, add `### Open decisions`, each a concrete question with its options. For `needs-info`, write the established facts and the questions in place of the brief. For `wontfix`, write why, then close the issue.

Then set the labels: add the category, the state and, where it applies, the location label, and remove `needs-triage`. Create a missing label with `POST /labels` first: `cloud` (`{"name":"cloud","color":"0E8A16","description":"Work an unattended cloud session can do"}`) or `local` (`{"name":"local","color":"B60205","description":"Work that needs Brahm's machine, data or credentials"}`).

## 6. Report

End with the issue number, the labels applied, the one-line reason for each decision and, for a suggestion issue, the status recorded.
