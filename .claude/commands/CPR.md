---
description: Jolt the local implementer by hand, through the same path as its post-run beat, and report whether the runner that receives the jolt is online.
disable-model-invocation: true
---

# /CPR

Local lane only. The cloud lane gets no jolt: it has no gate, so each one would start a paid session, and it already starts on labels.

1. Run `env -u GH_TOKEN gh workflow run local-implementer-trigger.yml --ref main --repo Mharbulous/probanda-dev`.
2. Run `env -u GH_TOKEN gh api repos/Mharbulous/probanda-dev/actions/runners --jq ".runners[] | {name, status, busy}"`.
3. Report one line:
   - A runner is `online`: the jolt was sent. The script's gate decides whether Claude Code starts, and its log is under `%LOCALAPPDATA%\probanda-local-implementer\logs`.
   - No runner is `online`: the jolt waits in GitHub's queue until the PC's runner returns, and GitHub drops it after 24 hours.

A jolt starts a round only when an issue is takeable. It never clears a claim.
