# Stop false human gates starving the issue queue

## Context

Outcome: an issue carries `ready-for-human` only when a person is really needed, and the 15 issues now wrongly parked there move on.

On 2026-11-04, 15 of 16 open issues are `ready-for-human` and none is `ready-for-agent`. The automation itself runs: last night's local run (`run-20261104-030157.log`) ended with "The local queue was empty". This follows `docs/Plans/2026-11-02_unstick-issue-automation.md`, which fixed the install refusal and sweep but kept routing these issues to Brahm. On approval, copy this plan to `docs/Plans/2026-11-04_human-gate.md` and have it reference that one.

**Limits.** Priority where they conflict: real human stops beat queue flow.
- Unchanged: `no-regression-suite.py`, the package-install guard, the `public/` approval hook, `COMMANDMENTS.md`, and the rule that an issue never closes with a Done-when check not run. Never dispatch CI by hand to get past the test hook.
- Unchanged: suggestion items stay Brahm's (design decisions 17 and 20), and a minor version still needs his go-ahead (`release.md:46`, and the 2026-11-02 version plan keeps these stops).
- Before changing the local gate, dispatch `requirement-advocate` on the "whole test suite" gate item and the hand-back rule, and report what it finds.

## Part 1: Fix the process

There is no single bad step. Six leaks feed the same label.

| # | Leak | Where | Issues it caught |
|---|---|---|---|
| A | Any open question or judgement call means human | `triage-issue.md:100` | #202, #216, #227, #230 |
| B | Every implementer gate failure goes straight to human | `implement-queue.md:32-33` | #187, #188, #200, #212, #217, #220, #223 |
| C | Briefs hold checks the run can't perform: whole suites, "next nightly", unchanged test files the hook refuses | `triage-issue.md:124` | #188, #200, #206, #217, #220, #230 |
| D | An unattended run can't write under `.claude/`, despite the allowlist | clone's `settings.local.json` | #191 |
| E | The nightly safety net is blind | `data-mcp-tests.yml:52,110` | all failure issues |
| F | A recorded minor approval is ignored | `implement-queue.md:32` | #187 |

**1. Name what needs a person (A).** Add a section "What needs a person" to `docs/agents/issue-tracker.md`, and have triage, implement-queue and `hitl-triage` point to it. It must live in this repo, because cloud runs may not load the toolkit's `/grilling`. It is a closed list, condensed from grilling's exceptions:
- a suggestion item;
- consequential authorization: `public/`, `COMMANDMENTS.md`, a minor version, a migration of real data, anything destructive or externally visible;
- the work shows an adopted rule or decision is itself wrong;
- the code, tests and docs don't establish the intended behaviour;
- a new dependency, runtime or service;
- deciding evidence is disproportionately costly;
- a check that only a person can perform, such as a live Cowork session.

Anything else, triage decides itself and records under `### Decisions` with its reason and the option rejected, so Brahm can override it. Rewrite `triage-issue.md:100` to this rule. Triage may not write a stop rule that hands an issue to a person unless the reason is on the list (this caused #212).

**2. Add `### After landing` to the brief (C).** It holds checks that only CI can run. They are not Done-when checks, so the never-close rule still holds, and a nightly failure files a new issue because the filer opens one when no open issue matches. Done when may name a test file only if the Plan creates or edits it. An existing red test's failing assertion, quoted from the nightly, counts as red evidence, because the hook refuses a base run of an unchanged file (#200).

**3. Add `scripts/check_brief.py` (A, C).** Fixed rules belong in code. It runs over a brief before posting, like `check_verbatim.py`, and fails when:
- Done when holds a whole-suite or folder run, or a "next scheduled run" line;
- Done when names a test file that the Plan and Scope don't include;
- a `ready-for-human` brief has an open decision with no `Needs a person:` line from the closed list.

Write it test first, as `scripts/tests/test_check_brief.py`. Call it from triage step 6 and from `hitl-triage/references/issue-route.md`.

**4. Route hand-backs by reason (B).** Add a `handback` subcommand to `scripts/choose_issue.py`, taking the gate item and the issue's comments, and printing the labels to apply. A closed-list reason goes to `ready-for-human`. Any other goes to `needs-triage`, so triage rewrites the brief, once; a second hand-back goes to `ready-for-human`. Both lanes use it. `choose_issue.py untriaged` and triage step 1 must accept a `needs-triage` issue that already has a brief. Remove "a whole test suite or folder" from the local gate, since step 2 moves those checks out.

**5. Smaller rules in `implement-queue.md` and `triage-issue.md` (B, F).**
- A sha256 page pin that fails only because the Plan deliberately changed that page is in scope to re-take (#223).
- A `### Decisions` line recording Brahm's minor go-ahead, in a comment from `/hitl-triage`, passes the minor gate and `release.md` step 4 (#187). Without one, the minor gate stands.
- A check naming the file `approve_public` goes to `local`, because that name stops a cloud run (#200).

**6. Let unattended runs write under `.claude/skills/` (D).** The cause is unverified. Try narrow rules (`Write(.claude/skills/**)`, `Edit(.claude/skills/**)`) in `register-local-implementer.ps1`, re-register, and test with one `claude -p` write in the clone, then discard it. If that fails, #191 stays `ready-for-human`, naming this as the reason, and Brahm hears it.

**7. Make the nightly finish (E).** `data-mcp-tests` was cancelled in 8 of its last 9 runs and last passed on 2026-10-25. It spent 27 minutes before the e2e tier on 2026-11-02, against a 30-minute limit. The filer's `if: failure()` also skips a cancelled run. Raise `timeout-minutes` to 120 and make it `failure() || cancelled()`. Windows minutes cost more; this is cheap to undo, so report the first finished run's time and trim the limit to fit.

## Part 2: Fix the queue

Do this only after Part 1 is on `main`, or the issues bounce back at the same gates. For each issue, check for a live claim, post a new complete `## Agent Brief` that passes `check_brief.py`, then relabel it. Relabel `cloud` issues last, because a label starts that run at once.

| Issue | New state | Lane | New brief |
|---|---|---|---|
| #187 | agent | local | Cite the minor go-ahead already recorded. Move unchanged test files to After landing |
| #188 | agent | local | Full-suite comparison moves to After landing |
| #191 | agent, after step 6 | local | Move unchanged test files to After landing |
| #200 | agent | local | Third check moves to After landing. The two fixture edits already passed |
| #202 | agent | local | Decide (a), raw override. Native blocked-by edge on #200 |
| #206 | agent | local | The install is fixed (`c7b3cc0c`). Nightly line moves to After landing |
| #212 | agent | local | Read render-path commits from the pin's origin `b699a7f` to HEAD. If all are deliberate, re-take the pin; if not, hand back with the commit named |
| #217 | agent | local | Nightly line moves to After landing |
| #220 | agent | local | Unit-test line moves to After landing. The edit already passed 4 of 4 |
| #223 | agent | local | Scope includes re-taking the Milestone pin, from a fresh build |
| #227 | agent | cloud | Rule 19 settles it: each skill calls the tool itself, all hook branches state facts only, the text names no tool |
| #230 | agent | local | Raise the limit to 180000 ms. The issue's 115 s is the measurement. Drop the #186 comparison, which the hook refuses and nothing depends on. e2e run moves to After landing |
| #193 | closed | | Superseded. First confirm the lifecycle plan's phases are on `main` |
| #216 | **human** | local | Decide name `chat_session`. The version rule says minor, so Brahm's go-ahead is still needed |
| #226 | **human** | local | Suggestion item, on the closed list |

#183 is unchanged: it is the parent, and closes after #206.

After this, Brahm has two decisions left, #216 and #226, through `/hitl-triage`.

## Verification

- `python -m pytest -q scripts/tests/test_check_brief.py` and `scripts/tests/test_choose_issue.py` pass, run by path.
- `check_brief.py` fails on the old briefs of #188, #200, #217, #220 and #230, and passes on each new brief.
- `gh issue list` shows 12 `ready-for-agent`, 2 `ready-for-human`, and #193 closed.
- The next nightly `data-mcp-tests` ends success or failure, not cancelled. Wait for it, since manual dispatch is off limits.
- The next local log shows issues worked. Any hand-back names a closed-list reason or goes to `needs-triage`.
- After three nightly runs, every `ready-for-human` issue has a `Needs a person:` line.

## Out of scope

- Fixing the issues themselves: the implementers do that.
- Removing the minor-version stop, which waits on the 2026-11-02 version plan's conditions.
- Changing `/grilling`.
- Cloud routine configuration, which I have not inspected. If a cloud issue still doesn't start after relabelling, check it then.

## Result of step 6 (2026-11-04)

The narrow rules failed. One `claude -p` write in the clone was refused under `Write(.claude/skills/**)` with `Edit(.claude/skills/**)`, under the root forms `Write(/.claude/skills/**)` with `Edit(/.claude/skills/**)`, and under `Edit(/.claude/skills/**)` alone. `dontAsk` mode refuses a write under `.claude/` whatever the allowlist says, so the rules were removed, the local gate names the limit, and #191 stays `ready-for-human`.

## Result of Part 2 (2026-11-04)

Two issues differ from the table, both because a real human stop outranks queue flow.

- **#191** stays `ready-for-human`, by step 6's result above.
- **#187** stays `ready-for-human`. Its recorded go-ahead names `lawyer`, `researcher`, `timekeeper` and `file-manager`, but `litigator`, `solicitor` and `developer` pin `lawyer` to `^0.21.12`, so a `lawyer` minor makes each of them a minor too. Its new brief asks Brahm whether the go-ahead covers those three.

So 10 issues are `ready-for-agent` and 4 are `ready-for-human`, in place of the 12 and 2 under Verification.

Later on 2026-11-04, Brahm extended the #187 go-ahead to `litigator`, `solicitor` and `developer`, recorded in comment 6629202020. That makes 11 `ready-for-agent` and 3 `ready-for-human` (#191, #216, #226).

## Result of the parallel batch (2026-11-04)

Brahm asked for the queue to run in parallel for this night only. Sessions and the local implementer split it by shared files, and every issue kept its claim.

- **In parallel, test-only:** #200 then #202 (one agent, because they share files), #212, #217, #220, #230.
- **In parallel, with a release:** #223 in the shared checkout, beside #188 and then #206 in the implementer's clone. Their releases collided on version numbers and built files, and merging and rebuilding resolved each collision. That cost repeated re-releases of #188, which is why the lock normally keeps releases apart.
- **In series:** #187 after #206, because both change `key-request/tools.ts`.

#187's first run handed it back with `node-modules`, since its clone had no packages for the commons and canlii bundles. Brahm approved installing them, and `a8c5d9df` added both to `run-local-implementer.ps1`. Before that run could take it again, it was held out of the queue, because a second hand-back would have sent it to `ready-for-human`. It was relabelled `ready-for-agent` after the lock was released, and landed in `5f0c659c` and `9ce00069`, a minor release of all seven plugins. That leaves no `ready-for-agent` issue and 3 `ready-for-human` (#191, #216, #226).

#202 also converted `scripts/tests/test_stamp_dependencies.py`, outside the 8 files of its Scope. The file was added after the brief, and the brief's check covers every test file.

An `off peak` label and queue rule were added and removed the same night (`bfa5b637`, reverted in `bfd50555`). They assumed peak hours cost more, but Anthropic removed that limit reduction for Claude Code on Pro and Max on 2026-05-06, and Brahm is on Max. Do not add it again without a source that says peak hours apply.
