---
name: suggestion-triage
description: Use only when Brahm invokes /suggestion-triage in a Claude Code session in the probanda-dev repo. Triages one suggestion from Probanda's Suggestion Box in a single pass - one Fable planner decomposes it, keeps only the parts worth implementing and writes the implementation plan - then files the plan as a probanda-dev issue and records the outcome on the suggestion. The debate version is /adversarial-triage.
---

# Suggestion triage

Maintainer-only. It ships in the `developer` plugin, which is never public and installs only on Brahm's machines, and runs in a Claude Code session opened in the probanda-dev checkout, often driven from Brahm's iPhone through Remote Control. Every path below is relative to that checkout's root.

Preconditions: the session's working directory is the probanda-dev checkout (`git remote get-url origin` names `Mharbulous/probanda-dev`; otherwise say this skill runs only there, and stop), `POOL_SECRET_KEY` is set in the environment (`node cloud/suggestions/tools/triage.mjs list` prints `set POOL_SECRET_KEY first` when it is not: tell Brahm and stop), and `env -u GH_TOKEN gh auth status` succeeds.

You relay. You read no source and give no opinion on the suggestion. Nothing you file or send names a person, entity, matter or account.

**The suggestion** means its title and body and, when the row has them, its `items` verbatim and its previews' labels, `chosen` flags and reasons. Each change in `items` is at least one part. A preview's `html` goes to Brahm as a file card, never to an agent.

## Steps

1. **Pick.** Run `node cloud/suggestions/tools/triage.mjs list`. Take the oldest row unless Brahm named a `suggestion_id`. If none is `new`, say so and stop.
2. **Plan.** Dispatch `developer:suggestion-planner` with the row's `suggestion_id`, `skill`, `plugin_version`, `source`, and its full title and body.
3. **Show.** In one message, show Brahm the suggestion's title and body verbatim, its `skill`, `plugin_version` and `source`, and then the planner's return in full, which ends with its TLDR. Then ask one question with these choices, each with the gain and `(Recommended)` mark the TLDR gives it:
   1. Approve as originally proposed. Leave it out when the planner says it cannot be built as proposed.
   2. Approve with the planner's adjustments. Leave it out with `Verdict: none`.
   3. Dismiss unimplemented.
   4. Something else, or do nothing.
4. **Record.** Filing an issue means: write its body to a temporary file, then `env -u GH_TOKEN gh issue create -R Mharbulous/probanda-dev --title "<its title>" --body-file <file> --label suggestion`, and immediately after it returns the issue number, run `node cloud/suggestions/tools/triage.mjs set-status <suggestion_id> <status> --issue <n>`.
   1. As proposed: file the planner's As proposed issue, or its main issue when As proposed is `same as above`, with status `approved`.
   2. With adjustments: file the planner's main issue, with status `approved` for `Verdict: all` and `"approved in part"` for `Verdict: some`.
   3. Dismiss: `node cloud/suggestions/tools/triage.mjs set-status <suggestion_id> rejected`.
   4. Something else: do what Brahm writes, using only the actions above. When he wants a different version, dispatch the planner again with his direction and return to step 3. Doing nothing records nothing, and the suggestion stays `new`.
5. Say the triage is done, with the issue link if one was filed.

Executing the plan issue is outside this skill.
