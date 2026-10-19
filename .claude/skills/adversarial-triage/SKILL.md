---
name: adversarial-triage
description: Use only when Brahm explicitly invokes /adversarial-triage in a Claude Code session in the probanda-dev repo. Triages one suggestion from Probanda's Suggestion Box by a debate between the black-hat and white-hat agents, judged by the suggestion-oracle agent, with Brahm deciding each part; files the plan as a probanda-dev issue and records the outcome on the suggestion.
disable-model-invocation: true
---

# Adversarial triage

Maintainer-only. It ships in the `developer` plugin, which is never public and installs only on Brahm's machines, and runs in a Claude Code session opened in the probanda-dev checkout, often driven from Brahm's iPhone through Remote Control. Every path below is relative to that checkout's root. Spec: `docs/Specs/2026-10-18_suggestion-triage-spec.md`.

Preconditions: the session's working directory is the probanda-dev checkout (`git remote get-url origin` names `Mharbulous/probanda-dev`; otherwise say this skill runs only there, and stop), `POOL_SECRET_KEY` is set in the environment (`node cloud/suggestions/tools/triage.mjs list` prints `set POOL_SECRET_KEY first` when it is not: tell Brahm and stop), and `env -u GH_TOKEN gh auth status` succeeds.

**The suggestion** means its title and body and, when the row has them, its `items` verbatim and its previews' labels, `chosen` flags and reasons. Each change in `items` is at least one part. A preview's `html` goes to Brahm as a file card, never to an agent.

## Rules for the orchestrator (you)

- You make every write: the notes files, the cap, the issue, the status, the commit. No agent writes anything.
- You read no source and give no opinion on the suggestion. You relay.
- **Blinding.** Never send a hat the other hat's notes, this file, or the scoring before step 5. Never send the oracle either hat's notes.
- **Notes.** A hat's notes for step N are the output of `python scripts/triage_notes.py show .claude/adversarial-triage/<hat>.md N`. Put them at the head of every message to that hat, under the heading `Your notes for this step`. Empty output means no notes.
- **Relay as it arrives.** Dispatch both hats in the background. Show each reply to Brahm, in full and labelled, as soon as its completion notification arrives, so the faster agent's text shows first. Do not wait for the second before showing the first.
- One agent per hat for the whole triage: dispatch each once at step 2, then resume it with `SendMessage` at every later step. The oracle likewise: dispatch at step 6, resume at step 7.
- Every message to an agent names the step and the word limit.
- Nothing you file or send names a person, entity, matter or account.

## Steps

1. **Pick.** Run `node cloud/suggestions/tools/triage.mjs list`. Take the oldest row unless Brahm named a `suggestion_id`. If none is `new`, say so and stop. Write a face-value summary of at most 1000 characters: what it asks for, as written. Show the summary with the row's `suggestion_id`, `skill`, `plugin_version` and `source`.
2. **Arguments.** Dispatch `developer:black-hat` and `developer:white-hat` in parallel (`run_in_background: true`), each with the summary, the full title and body, and its step-2 notes. Black-hat: the best case for doing nothing, 500 words or fewer. White-hat: the best case for implementing, 500 words or fewer, free to argue for a better variation. Show each as it arrives.
3. **Critiques.** Send each hat the other's argument and its step-3 notes. Each returns a critique of 300 words or fewer. Show each as it arrives.
4. **Replies.** Send each hat the other's critique and its step-4 notes. Each replies in 300 words or fewer. Show each as it arrives.
5. **Concessions.** Send each hat the other's reply, its step-5 notes and, for the first time, the scoring: −1 per contested point lost, 0 per point conceded now, +1 per tie, +2 per point won. Each names the points it concedes. Show each as it arrives.
6. **Judgement.** Dispatch `developer:suggestion-oracle` with the summary, the title and body, both arguments, critiques, replies and concessions, and the scoring. It reads `.claude/adversarial-triage/human-guidance.md` itself. Show its decision in full and forward it to both hats.
7. **Notes and decisions, at once.**
   - In the same message that forwards the decision, ask each hat for the full new text of its notes file (3000 characters at most, `<stepN>` tags allowed), in the background. As each arrives, write it to `.claude/adversarial-triage/<hat>.md` exactly as returned, then run `python scripts/triage_notes.py cap .claude/adversarial-triage/<hat>.md`.
   - Meanwhile resume the oracle: split the suggestion into independent parts, three options each (implement as proposed, implement with its modification, reject), with its recommendation, and add a plain explanation of the feature the suggestion concerns: what the page or tool is and what the user sees today. Present one part per message. Every part message is self-contained, because twenty debate messages bury step 1 and Brahm often answers from an iPhone, where a question card shows without the earlier context. Each one carries, in this order: the suggestion's full title and body verbatim, its `skill`, `plugin_version` and `source`, the oracle's explanation of the feature, then the part, the options side by side, the recommendation marked, and the question. Wait for Brahm's answer before the next part.
   - After the last answer, send the decisions to the oracle; it writes the implementation plan.
   - If Brahm approved any part: write the issue body to a temporary file (the plan, the decision on each part, and the line `Suggestion <suggestion_id>`), then `env -u GH_TOKEN gh issue create -R Mharbulous/probanda-dev --title "<the suggestion's title>" --body-file <file> --label suggestion`. Immediately after it returns the issue number, run `node cloud/suggestions/tools/triage.mjs set-status <suggestion_id> <approved|"approved in part"> --issue <n>`: `approved` when every part was approved, `approved in part` otherwise.
   - If Brahm approved no part: once he confirms that no part is implemented, run `node cloud/suggestions/tools/triage.mjs set-status <suggestion_id> rejected`.
8. **Commit.** Once both notes files are written and capped: `git -C <repo root> commit -m "Adversarial triage notes after <suggestion_id>" -- .claude/adversarial-triage/black-hat.md .claude/adversarial-triage/white-hat.md`, then `git pull --ff-only` and `env -u GH_TOKEN git push`. Then say the triage is done, with the issue link if one was filed.

Executing the plan issue is outside this skill.
