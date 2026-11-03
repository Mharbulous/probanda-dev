# Issue route

For an issue step 1 of `SKILL.md` sent here: any issue without both the label `suggestion` and a `Suggestion <id>` line. It has no Suggestion Box record, so `triage.mjs`, `check_verbatim.py`, `select_approved_items.py` and `fix-maker` play no part. The implementer builds it from its latest `## Agent Brief` (`.claude/commands/implement-suggestions.md`).

## Steps

2. **Read.** Read the issue and every comment (`gh issue view <n> -R Mharbulous/probanda-dev --json body,labels,comments`). The latest `## Agent Brief` is the work order. Its `### Open decisions` are what to ask. When a run handed the issue back, the latest comment says why, and the decision is what to do about that fault: try again, change the plan or stop. Read the code the brief names when a recommendation needs it.
3. **Decide, one open decision per message.** Each message holds what the issue is in plain words, what triage verified, the question with its options, and "do nothing". Mark as recommended each option that beats doing nothing, with its one-line gain, and mark doing nothing only when no option beats it. An answer may raise a further question: ask it the same way.
4. **Record.** Once every open decision has an answer, take the route that fits:
   - **Go ahead:** post one comment that opens with `> *Decisions recorded by /hitl-triage.*` and holds a new, complete `## Agent Brief`: its Verification, a Plan, Scope and Done when with the answers built in, its red tests, and a `### Decisions` list with one line per decision and its answer. It replaces the old brief, so it refers to none of it and holds no open decision. Done when holds only checks an agent can run. A check only a person can run makes the implementer hand the issue back, so ask Brahm to run it or drop it, and record which. Then ask one question: relabel now, `gh issue edit <n> -R Mharbulous/probanda-dev --remove-label ready-for-human --add-label ready-for-agent` (Recommended: a `cloud` issue starts building at once, and the nightly job takes a `local` one), or leave it. Keep its location label, and add `cloud` or `local` when it has neither.
   - **No:** comment with the reason in one plain line, then `gh issue close <n> -R Mharbulous/probanda-dev --reason "not planned"`.
   - **Some unanswered:** comment with the answers given, so none is lost, and leave the labels alone.
