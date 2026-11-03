# Unstick probanda-dev's issue automation

Status: approved by Brahm on 2026-11-02.

## Goal
This repo's issue automation stays, and so does its human approval stop. On 2026-11-02 its 19 open issues were stuck: 9 needed Brahm's decision, 5 were handed back, 4 were never triaged and 1 was blocked. This plan fixes what stops them.

Current files: `.claude/commands/triage-issue.md`, `.claude/commands/implement-queue.md`, `docs/agents/issue-tracker.md`, `scripts/local-implementer/run-local-implementer.ps1`. Routines: "Triage new issues" `trig_01HzqbUKQXED8BT7rkNBR8zv` (event only, no schedule) and "Implement suggestion issues" `trig_012StPmMPbSYJr7HLYoqEJN5`.

## 1. Never-triaged issues (#200, #202, #209, #226)
Find out why they were missed, by reading the routine's run history. Add a nightly schedule to "Triage new issues", if its prompt can work without an event, or a small backstop that triages every issue carrying no state label.

Unverified: whether a nightly routine can run `/triage-issue`, which expects an event or issue number.

## 2. Package-install refusals (#185, #206)
`run-local-implementer.ps1` runs `npm ci --ignore-scripts` in `source/lawyer/mcp` itself before starting Claude Code, using only the committed lockfile.

Brahm approved this route on 2026-11-02. The guard reserves installs for the human, and this keeps the model from installing while the script he registered does it. The guard itself is not changed. Its source file was not found in `~/.claude/hooks`, so locate it first, and stop and ask if it also covers this route.

## 3. Decisions (9 issues)
Brahm decides #183, #185, #186, #187, #188, #193, #194, #216 and #227, one at a time, with options and a recommendation. #194 goes first, because #191 waits on it. #193 looks replaced by finished work according to its last comment, so check whether it can close.

## 4. Hand-backs
Read why #212, #217, #220 and #223 were handed back, and report it. Fix only what falls under the fixes above.

## Verification
- `-PrepareOnly` installs packages in the clone and leaves it clean.
- The next nightly log shows #185 or #206 past the refusal.
- The 4 untriaged issues get briefs.
