---
name: suggestion-triage
description: Use only when Brahm invokes /suggestion-triage in a Claude Code session in the probanda-dev repo. Triages one suggestion from Probanda's Suggestion Box in a single pass - one Fable planner decomposes it, keeps only the parts worth implementing and writes the implementation plan - then files the plan as a probanda-dev issue and records the outcome on the suggestion. Then offers to implement a filed issue at once through an Opus subagent instead of waiting for the nightly cloud run. The debate version is /adversarial-triage.
---

# Suggestion triage

Maintainer-only. It ships in the `developer` plugin, which is never public and installs only on Brahm's machines, and runs in a Claude Code session opened in the probanda-dev checkout, often driven from Brahm's iPhone through Remote Control. Every path below is relative to that checkout's root.

Preconditions: the session's working directory is the probanda-dev checkout (`git remote get-url origin` names `Mharbulous/probanda-dev`; otherwise say this skill runs only there, and stop), `POOL_SECRET_KEY` is set in the environment (`node cloud/suggestions/tools/triage.mjs list` prints `set POOL_SECRET_KEY first` when it is not: tell Brahm and stop), and `env -u GH_TOKEN gh auth status` succeeds.

You relay. You read no source and give no opinion on the suggestion. Nothing you file or send names a person, entity, matter or account.

**The suggestion** means its title and body and, when the row has them, its `items` verbatim and its previews' labels, `chosen` flags and reasons. Each change in `items` is at least one part. A preview's `html` goes to Brahm as a file card, never to an agent.

## Steps

1. **Pick.** Run `node cloud/suggestions/tools/triage.mjs list`. Take the oldest row unless Brahm named a `suggestion_id`. If none is `new`, say so and stop.
2. **Plan.** Dispatch `developer:suggestion-planner` with the row's `suggestion_id`, `skill`, `plugin_version`, `source`, and its full title and body.
3. **Show.** Write the planner's return in full to a temporary file. In one message, show Brahm the suggestion's title and body verbatim, its `skill`, `plugin_version` and `source`, and then the planner's TLDR verbatim, and send the file as a file card. Then ask one question with these choices, each with the gain and `(Recommended)` mark the TLDR gives it:
   1. Approve as originally proposed. Leave it out when the planner says it cannot be built as proposed.
   2. Approve with the planner's adjustments. Leave it out with `Verdict: none`.
   3. Dismiss unimplemented.
   4. Something else, or do nothing.
4. **Record.** Filing an issue means: write its body to a temporary file, then `env -u GH_TOKEN gh issue create -R Mharbulous/probanda-dev --title "<its title>" --body-file <file> --label suggestion,ready-for-agent,cloud`, and immediately after it returns the issue number, run `node cloud/suggestions/tools/triage.mjs set-status <suggestion_id> <status> --issue <n>`.
   1. As proposed: file the planner's As proposed issue, or its main issue when As proposed is `same as above`, with status `approved`.
   2. With adjustments: file the planner's main issue, with status `approved` for `Verdict: all` and `"approved in part"` for `Verdict: some`.
   3. Dismiss: `node cloud/suggestions/tools/triage.mjs set-status <suggestion_id> rejected`.
   4. Something else: do what Brahm writes, using only the actions above. When he wants a different version, dispatch the planner again with his direction and return to step 3. Doing nothing records nothing, and the suggestion stays `new`.
5. Say the triage is done, with the issue link if one was filed.
6. **Implement now?** Only when step 4 filed an issue, ask in the same message as step 5 one question with these choices:
   1. Implement it now (Recommended: it lands today instead of waiting up to a day for the nightly cloud run, whose gate may also relabel it `local`).
   2. Do nothing. The nightly run (`.claude/commands/implement-suggestions.md`) takes it.

   On 1, dispatch Agent with `subagent_type: general-purpose`, `model: opus` and `effort: medium`, in the background, with the brief below and the issue number in place of `<n>`. When it returns, relay its report in full, including any check it left for Brahm.

   ```text
   Implement probanda-dev issue #<n> in this checkout and land it on main. The issue is a work order with Plan, Scope and Done when sections. Run every gh call as `env -u GH_TOKEN gh`.

   Rules for the whole run:
   - Other sessions work in this checkout and leave uncommitted files. Never run git checkout, reset, stash, clean or rebase. Never edit, commit or revert a file outside the issue's Scope.
   - Commit by explicit pathspec (`git commit -F <msg file> -- <paths>`), never `git add -A`. The message says what changed and why, and never mentions Claude or Anthropic.
   - Push only to main. If `git pull --ff-only` is refused, merge origin/main by the git rules in Brahm's global CLAUDE.md, never by rebase.

   1. Claim the issue by docs/agents/issue-tracker.md **Claim** steps 1 to 4 before any edit, and record the claim id. If it is claimed or blocked, stop and report that.
   2. Read the Plan, Scope and Done when in full. Follow the Plan inside the Scope.
   3. Run every Done-when check, then `python scripts/check_layering.py`, `python scripts/check_file_ops.py` and `python scripts/check_publishable.py --new-since origin/main`.
   4. Classify the change by .claude/commands/release.md step 4. Minor or 1.0: take the stop route (step 6).
   5. Commit the source change by pathspec. Then release by .claude/commands/release.md steps 2, 3 and 5 to 7, patch only. Release's clean-tree check, its list of plugins and its commit cover only this issue's files, the plugins they feed, the bumped plugin.json files and the plugins/ files built from them, each named by path. `python scripts/build_plugin.py --check` and `python scripts/check_plugin.py` must pass.
   6. Stop route: a minor bump, a failed check you cannot fix inside the Scope, or a check that needs a person (a live service, a browser, public/ approval). Never fake or skip such a check. Restore your own uncommitted edits with `git restore -- <your paths>` and delete any new file you created. Release the claim by issue-tracker.md **Release**, whose comment says why. Report the reason, and any check Brahm must run, and stop.
   7. Land: after the push, comment on the issue with the commit SHA, each check run and its result, and anything in the Plan not done. Close it with `gh issue close <n>`, then delete your claim comment (issue-tracker.md **Release**, delete only). Report the SHA, the versions, the check results and anything left for Brahm.
   ```
