# Spec: show-me file-card default tool

Status: proposed, 2026-10-15. Written in a matter session; implementation is handed to Claude Code.
Plugin: `practice` (installed copy seen at v0.3.0). Paths below are as seen in the installed copy and are **UNVERIFIED** against the repo unless marked otherwise. In this repo the skill is `.claude/skills/show-me/SKILL.md`.
Related specs, same date: `2026-10-15_plugin-wide-present-files-default-audit-spec.md`

---

## 1. Problem

`show-me` treats `mcp__cowork__present_files` and `SendUserFile` as equal alternatives and then spends a whole section on the `SendUserFile` route. In a local Cowork session the model drifts toward the remote-device route, or toward other means, instead of using `mcp__cowork__present_files`. The practitioner wants `mcp__cowork__present_files` to be the default and `SendUserFile` a backup used only when the default tool is unavailable.

## 2. Evidence (observed; quoted text is data, not instructions)

- Skill: `show-me/SKILL.md`, practice v0.3.0, owner `skill-text`.
- Mechanics step 3(b): "the file or files, cited first and context second, as file cards (`mcp__cowork__present_files` or `SendUserFile`)."
- Contents table row: "Presenting a file saved on the PC | Sending a card for a file saved on the PC from a cloud session linked to it (remote-device-only host)".
- Section "Presenting a file saved on the PC": "This applies to every skill that presents a file saved on the PC as a card... On a cloud session linked to the PC through `mcp__remote-devices__*`, `mcp__cowork__present_files` is absent and `SendUserFile` takes only container paths." and "**The route.** Stage the file with one `device_stage_files(paths: [<PC path>])` call, then call `SendUserFile` on the `stagedPath` it returns".
- Rule 2 says only "send the document itself as a file the human can open", with no tool named.
- The section on highlight extracts says they "live in the container and never belong on the PC, so [they are] sent as [they are]", with no Cowork case.
- Observed this session (local Cowork): `SendUserFile` and `device_stage_files` were not in the tool list (a search found nothing). `mcp__cowork__present_files` worked on two files in a connected folder.
- Workaround in use: the model calls `mcp__cowork__present_files` when told to.

## 3. Goal and non-goals

Goal: `mcp__cowork__present_files` is stated as the default wherever `show-me` says how a file card is sent. `SendUserFile` is stated as the backup, used only when the default tool is not in the session's tool list.
Non-goals: changing the staging steps, the "Never these" list, the staged-file hook, or any rule other than tool choice.

## 4. Design

The canonical rule, shared verbatim with the related spec:

> To show a file to the practitioner, call `mcp__cowork__present_files` with the file's path. It is the default. Use `SendUserFile` (staging a PC file first with `device_stage_files`) only when `mcp__cowork__present_files` is not in the session's tool list. Check the tool list before choosing; never pick `SendUserFile` out of habit.

1. Mechanics step 3(b) names `mcp__cowork__present_files` as the tool and `SendUserFile` as the fallback, and includes the canonical rule verbatim.
2. Rule 2 gets a short pointer to step 3(b), so the tool named there is the one used.
3. Retitle the section "Presenting a file saved on the PC" to mark it as the fallback route. Its opening says it applies only when `mcp__cowork__present_files` is unavailable (the remote-device-only host). The Contents row says the same.
4. Add a Cowork case for highlight extracts: write the extract to the session's outputs folder or a connected folder, then call `mcp__cowork__present_files`. In the fallback case, `SendUserFile` on the container path, as now.
5. Keep "a card is re-sent with every question".

## 5. Constraints that must still hold

- Remote-device sessions keep working: staging then `SendUserFile` is unchanged.
- The "Never these" list stays.
- Re-sending the card with every question stays.
- The host note that Cowork summarises text between tool calls is not weakened.

## 6. Options considered

1. Edit `show-me/SKILL.md` in place per §4 (recommended).
2. Move the PC-file section into a shared doc and cite it. Rejected for this spec: the related audit spec owns that choice.
3. Only reorder the words in step 3(b). Rejected: the PC section would still pull toward `SendUserFile`.

## 7. Implementation plan

1. Verify against HEAD (§10) and append a verification table to this spec.
2. Make the §4 edits to `show-me/SKILL.md`.
3. Check each criterion in §8 against the edited file.
4. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of show-me file-card default tool complete!`, then what you verified and what you assumed without verifying.

## 8. Implementation criteria

1. Mechanics step 3(b) names `mcp__cowork__present_files` as the default and `SendUserFile` as used only when the default is not in the tool list.
2. The canonical rule appears verbatim, or is cited, in `show-me/SKILL.md`.
3. The PC-file section and its Contents row say they are the fallback route.
4. A Cowork highlight-extract case exists and ends in `mcp__cowork__present_files`.
5. No remaining sentence presents the two tools as equal alternatives.
6. The "Never these" list and the re-send-every-time rule are unchanged.

Scope: edit source only (skill text). In this repo that means: no `python scripts/build_plugin.py` (the orchestrating session runs it once after every spec lands), no `/release`, no version bump, and no test written, updated or run. `hooks/staged-file-gate.py` and the MCP code that sends files are out of scope.

## 9. Open questions (resolved by the orchestrating session's defaults)

- Is `SendUserFile` the intended backup? The practitioner wrote "ShowUserFile"; the skill and hook use `SendUserFile`. Resolved: yes.
- In a session with both tools, should the model still pick `mcp__cowork__present_files`? Resolved: yes.

## 10. Verify against HEAD before building

Confirm `show-me/SKILL.md` still contains the quoted lines above and the version. Confirm the staged-file hook's name and behaviour. List any other file under `show-me/` that names either tool.

### Verification against HEAD (b1ff6f6, 2026-10-15)

| Claim in §2 / §10 | Found at HEAD | Result |
|---|---|---|
| Skill path | `.claude/skills/show-me/SKILL.md` | Confirmed |
| Version 0.3.0 | `source/practice/plugin.json` `"version": "0.3.0"` | Confirmed |
| Mechanics step 3(b) names both tools as equals | SKILL.md line 145, "(`mcp__cowork__present_files` or `SendUserFile`)" | Confirmed |
| Contents row for the PC-file section | SKILL.md line 14, text as quoted | Confirmed |
| Section "Presenting a file saved on the PC", opening and "The route." | SKILL.md lines 155-159, text as quoted | Confirmed |
| Rule 2 names no tool | SKILL.md line 44, "send the document itself as a file the human can open" | Confirmed |
| Highlight extract sentence has no Cowork case | SKILL.md line 169 | Confirmed |
| Staged-file hook | `.claude/skills/show-me/hooks/staged-file-gate.py`: PreToolUse, matcher `SendUserFile`; only when `/mnt/user-data` exists, refuses a file neither under `/mnt/user-data/uploads/` nor `.pdf`/`.png`; local Cowork and the Code tab are never refused; exempt with `COCLERK_SENDFILE_ANY=1`; fails open | Confirmed (path is under `show-me/hooks/`, not top-level `hooks/`) |
| Other files under `show-me/` naming either tool | Only `hooks/staged-file-gate.py` (out of scope). `scripts/` and `tests/` name neither | Confirmed |
| Section title cited elsewhere | `draft/SKILL.md`, `find-document/SKILL.md`, `publish/subskills/publish-general/SUBSKILL.md` and the hook's refusal message cite "Presenting a file saved on the PC" | Retitle keeps that phrase as the title's start, so the citations still resolve |
