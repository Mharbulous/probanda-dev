---
name: suggestion-triage
description: Use only when Brahm invokes /suggestion-triage in a Claude Code session in the probanda-dev repo. Triages one suggestion from Probanda's Suggestion Box in a single pass - one Fable planner decomposes it, keeps only the parts worth implementing and writes the implementation plan - then files the plan as a probanda-dev issue and records the outcome on the suggestion. The debate version is /adversarial-triage.
---

# Suggestion triage

Maintainer-only. It ships in the experimental `lawyer` plugin, which installs only on Brahm's machines, and runs in a Claude Code session opened in the probanda-dev checkout, often driven from Brahm's iPhone through Remote Control. Every path below is relative to that checkout's root.

Preconditions: the session's working directory is the probanda-dev checkout (`git remote get-url origin` names `Mharbulous/probanda-dev`; otherwise say this skill runs only there, and stop), `POOL_SECRET_KEY` is set in the environment (`node cloud/suggestions/tools/triage.mjs list` prints `set POOL_SECRET_KEY first` when it is not: tell Brahm and stop), and `env -u GH_TOKEN gh auth status` succeeds.

You relay. You read no source and give no opinion on the suggestion. Nothing you file or send names a person, entity, matter or account.

## Steps

1. **Pick.** Run `node cloud/suggestions/tools/triage.mjs list`. Take the oldest row unless Brahm named a `suggestion_id`. If none is `new`, say so and stop.
2. **Plan.** Dispatch `lawyer:suggestion-planner` with the row's `suggestion_id`, `skill`, `plugin_version`, `source`, and its full title and body.
3. **Show.** In one message, show Brahm the suggestion's title and body verbatim, its `skill`, `plugin_version` and `source`, and then the planner's return in full. Then ask one question: file it as an issue, or do nothing. With `Verdict: none`, the question is instead whether to record the suggestion as rejected, or do nothing.
4. **Record.**
   - Filing: write the body to a temporary file, then `env -u GH_TOKEN gh issue create -R Mharbulous/probanda-dev --title "<the planner's title>" --body-file <file> --label suggestion`. Immediately after it returns the issue number, run `node cloud/suggestions/tools/triage.mjs set-status <suggestion_id> <approved|"approved in part"> --issue <n>`: `approved` for `Verdict: all`, `approved in part` for `Verdict: some`.
   - Rejecting: `node cloud/suggestions/tools/triage.mjs set-status <suggestion_id> rejected`.
   - Doing nothing: record nothing. The suggestion stays `new`.
5. Say the triage is done, with the issue link if one was filed.

Executing the plan issue is outside this skill.
