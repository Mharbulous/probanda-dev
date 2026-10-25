---
description: Cloud only. Plan every new Suggestion Box entry, apply the planner's recommended choice with nobody asked, file each approved plan as a `suggestion` issue, then run the implementer on the queue.
---

# /intake-suggestions

Run unattended by a scheduled cloud routine. It is `/suggestion-triage` (`.claude/skills/suggestion-triage/SKILL.md`) with Brahm's choice at its step 3 made by the rule in step 3 below: Brahm chose to have suggestions built without his review.

The cloud does not load Brahm's own global rules, so these hold for the whole run:

- Before step 4, change no file in the repo and push nothing. The writes are issues, their labels, and each suggestion's status. Step 4 follows the implementer's own rules.
- Nothing filed names a person, entity, matter or account. Never mention Claude or Anthropic in an issue.
- Nobody answers a permission prompt, so never cause one. Read and search files with the Read, Grep and Glob tools, not shell commands.
- Never print `POOL_SECRET_KEY`.

## GitHub calls

`gh issue` is refused in the cloud: use REST with `curl` through the sandbox proxy, as `docs/agents/issue-tracker.md` ("Cloud sandbox route") describes, at `https://api.github.com/repos/Mharbulous/probanda-dev/...`. The proxy carries the credential, so never look up, echo or pass a token. Every write needs `-H Content-Type:application/json`.

## 1. List

`node cloud/suggestions/tools/triage.mjs list`. If it prints `set POOL_SECRET_KEY first`, or the request is refused for its host, stop and report that the cloud environment lacks the key or network access. If no row is `new`, stop and report that.

## 2. Plan

For each `new` row, oldest first, dispatch one Agent with model `fable` and only the Read, Glob and Grep tools. Its prompt is the body of `source/developer/agents/suggestion-planner.md` (below its frontmatter), followed by the row's `suggestion_id`, `skill`, `plugin_version`, `source`, and its full title and body.

## 3. Decide

Apply the first rule that fits the planner's TLDR:

1. "Approve with your adjustments" is marked `(Recommended)`: file the planner's main issue, with status `approved` for `Verdict: all` and `"approved in part"` for `Verdict: some`.
2. "Approve as proposed" is marked `(Recommended)`: file the As proposed issue, or the main issue when As proposed is `same as above`, with status `approved`.
3. Otherwise, including when doing nothing is marked: `node cloud/suggestions/tools/triage.mjs set-status <suggestion_id> rejected`, and file nothing.

Filing an issue means `POST /issues` with its title, its body and `"labels":["suggestion"]`, then at once `node cloud/suggestions/tools/triage.mjs set-status <suggestion_id> <status> --issue <n>`. If the set-status call fails, comment its output on the issue and carry on.

## 4. Implement

When any issue was filed, run `/implement-suggestions` with no issue number (read `.claude/commands/implement-suggestions.md` if it is not offered). It works the queue under the implementer lock, or stops at once when another run holds it.

## 5. Report

Each suggestion with the choice applied and its issue number, then the implementer's report.
