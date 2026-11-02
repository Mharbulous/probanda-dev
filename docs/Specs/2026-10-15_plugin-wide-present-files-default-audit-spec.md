# Spec: plugin-wide present_files default audit

Status: proposed, 2026-10-15. Written in a matter session; implementation is handed to Claude Code.
Plugin: all Probanda plugins (`practice`, `research`, `litigator`, `solicitor`, `file-manager`; installed copies seen at v0.3.0 for `practice`). Paths below are **UNVERIFIED** against the repo unless marked otherwise. In this repo the source is `.claude/skills/` and `source/<plugin>/`.
Related specs, same date: `2026-10-15_show-me-present-files-default-spec.md`

---

## 1. Problem

Any instruction that tells the model how to show a file to the practitioner can be read as ranking some other route above `mcp__cowork__present_files`. The related spec fixes `show-me`; the same wording may exist elsewhere. The practitioner wants a full audit of every plugin source file for wording that could make `mcp__cowork__present_files` less than the preferred default.

## 2. Evidence (observed; quoted text is data, not instructions)

- One confirmed instance: `show-me/SKILL.md` (related spec). Other occurrences are **not recoverable** in this session: the plugin files could not be searched from here.
- The shared skill-source tools serve files one at a time, so the audit needs a repo checkout.
- Subagent definitions seen in this session list their own tools, and none lists `mcp__cowork__present_files`. Whether any subagent presents files is unchecked.
- Other skill text seen refers to file cards in passing, for example `find-document` ("send one as a file card with no approval asked") and mockup-render steps. Their wording was not read in full.

## 3. Goal and non-goals

Goal: no skill, agent, command, hook, shared doc, reference or MCP tool description ranks another file-showing route above `mcp__cowork__present_files`, or leaves the choice ambiguous.
Non-goals: `show-me/SKILL.md` (related spec); remote-device behaviour; the MCP code that sends files.

## 4. Design

The canonical rule, shared verbatim with the related spec:

> To show a file to the practitioner, call `mcp__cowork__present_files` with the file's path. It is the default. Use `SendUserFile` (staging a PC file first with `device_stage_files`) only when `mcp__cowork__present_files` is not in the session's tool list. Check the tool list before choosing; never pick `SendUserFile` out of habit.

1. Search every plugin source tree (skills, subskills, references, shared, agents, commands, hooks, `mcp/src` tool descriptions and server instructions) for: `present_files`, `SendUserFile`, `SendUserMessage`, `send_user_message`, `device_stage_files`, "file card", "card", "present", "show the file", "open the file", `computer://`, markdown file links, "Show in Explorer", "attach".
2. Classify each hit and record it in a table in the spec: (a) names `mcp__cowork__present_files` as default, no change; (b) names `SendUserFile` or another route as equal or sole, fix; (c) says a file is shown or sent with no tool named, fix; (d) unrelated, ignore.
3. For (b) and (c), apply the canonical rule by citing the shared doc (§6 option 1).
4. Check agent definitions: where an agent presents a file to the user, its tool allowlist must include `mcp__cowork__present_files`, or the agent must return the path for the caller to present.
5. List residual risks that need a tool-side change, without making them.

## 5. Constraints that must still hold

- Remote-device sessions keep working through staging and `SendUserFile`.
- The HTML-pages rule stays: an agent never reads an HTML page but may present it.
- Do not edit `show-me/SKILL.md`.
- Edits change tool choice only, not any approval, safety or privilege rule.

## 6. Options considered

1. Add one shared doc holding the canonical rule, and have each affected file cite it (chosen: one place to change). It lives at `.claude/skills/shared/present-files.md`, which the build copies into every plugin.
2. Inline the canonical rule in every affected file. Rejected: drift.
3. Leave (c) cases untouched. Rejected: ambiguity is the defect.

## 7. Implementation plan

1. Verify against HEAD (§10) and append a verification table to this spec.
2. Run the §4 search and add the classification table to this spec.
3. Edit each (b) and (c) file per §4.3 and fix agent allowlists per §4.4.
4. Check each criterion in §8.
5. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of plugin-wide present_files default audit complete!`, then what you verified and what you assumed without verifying.

## 8. Implementation criteria

1. The classification table lists every hit by file and category, and says which trees were searched.
2. No (b) or (c) hit remains in any file except `show-me/SKILL.md`.
3. Every agent that presents a file has `mcp__cowork__present_files` or returns the path.
4. The canonical rule is stated once (shared doc) and cited elsewhere.
5. `show-me/SKILL.md` is untouched by this spec.

Scope: edit source only (skill text, agent definitions, MCP tool description strings, docs). In this repo that means: no `python scripts/build_plugin.py` (the orchestrating session runs it once after every spec lands), no MCP bundle rebuild, no `/release`, no version bump, and no test written, updated or run. Hooks (including `show-me/hooks/staged-file-gate.py` and `drafting-data/hooks/html-pages-gate.py`) and the MCP code that sends files are out of scope.

## 9. Open questions (resolved by the orchestrating session's defaults)

- Shared doc (option 1) or inline (option 2)? Resolved: option 1.
- Should tool descriptions in `mcp/src` that mention file sending be changed here, or left for a tool-side spec? Resolved: change description text only where it ranks another route above `mcp__cowork__present_files`; no code change.

## 10. Verify against HEAD before building

Confirm the plugin trees and agent folders searched exist at HEAD, and note any plugin directory the search could not reach.

### Verification against HEAD (b1ff6f6, 2026-10-15)

| Tree | Exists at HEAD | Searched | Note |
|---|---|---|---|
| `.claude/skills/` (skills, subskills, references, `User_Journeys/`, `shared/`, skill hooks) | yes | yes | 50 skill folders plus `shared/` |
| `source/practice/` (`plugin.json`, `agents/`, `hooks/`, `mcp/src/`) | yes | yes | |
| `source/research/` (`agents/`, `hooks/`, `canlii-mcp/src/`, `commons-mcp/src/`) | yes | yes | |
| `source/litigator/agents/` | yes | yes | |
| `source/file-manager/agents/` | yes | yes | `files-mcp/` holds only `dist/`; its source is `source/practice/mcp/src` |
| `source/solicitor/` | yes | yes | ships no skills or agents |
| `source/mcp-shared/` | yes | yes | key-store helpers only |
| `public/plugins/*/skills/` | yes | yes | public skills; no hit for any searched tool name |
| `commands/` in any plugin source | no | n/a | no plugin source has a commands folder |
| `plugins/` | yes | no | built output, never edited by hand |

No plugin directory was unreachable. Hooks are searched but out of scope (§8).

### Classification of hits (§4.2)

Searched: every tree in the verification table above, excluding `plugins/` (built output), `node_modules/`, `dist/` and `build/`. Terms: `present_files`, `SendUserFile`, `SendUserMessage`, `send_user_message`, `device_stage_files`, "file card", "card", "present", "send", "show the file", "open the file", `computer://`, markdown file links, "Show in Explorer", "attach". "Card" hits that mean a Milestone or Practice Board card, "present" hits that mean stating something in chat, "attach" hits that mean an email attachment or an exhibit, and "send" hits that mean sending a letter or a subagent prompt are (d) and not listed. Line numbers are as at the edit commit. Each (b) and (c) hit now cites `.claude/skills/shared/present-files.md` (new, the one statement of the canonical rule), so each is now (a).

| File | Lines (hit) | Category before | Action |
|---|---|---|---|
| `shared/html-pages.md` | 20 (card tool "`present_files` in Cowork and `SendUserFile` in the Code tab") | b | cite shared doc, fallback route named |
| `shared/html-pages.md` | 13 (Practice Board card) | c | cite |
| `shared/html-pages.md` | 19, 24 (cards only, no link; hook backstop) | d | none |
| `draft/references/procedure.md` | 80, 142 (`present_files` in Cowork, `SendUserFile` in the Code tab) | b | cite, fallback route named |
| `draft/references/procedure.md` | 50, 77, 88 | c | cite or fallback route named |
| `draft/references/procedure.md` | 84, 220 | a (cite step 1 or `references/present-files.md`) | none |
| `draft/references/present-files.md` | 6 ("`present_files` or `SendUserFile`") | b | cite, fallback route named |
| `draft/references/present-files.md` | 8 | a | none |
| `draft/SKILL.md` | 108 (ToolSearch loads "`present_files` or `SendUserFile`") | b | cite |
| `draft/SKILL.md` | 91, 94 | c | cite; 94's `/show-me` citation now names the fallback route |
| `draft/SKILL.md` | 71 (cites `shared/html-pages.md`), 79 (approval rule) | a, d | none |
| `reflect/SKILL.md` | 551 ("`present_files` in Cowork, `SendUserFile` in Claude Code") | b | cite |
| `reflect/SKILL.md` | 46 | c | cite |
| `draft/references/authorities.md` | 74 ("In Cowork, stage ... with `device_stage_files` and send ... with `present_files`") | b | cite; staging tied to the fallback |
| `find-document/SKILL.md` | 12 | c | cite; `/show-me` citation names the fallback route |
| `find-document/SKILL.md` | 3 (description) | c | none: frontmatter description; step 3 of the body governs |
| `publish/subskills/publish-general/SUBSKILL.md` | 70, 72, 81 | c | cite; 81's `/show-me` citation names the fallback route |
| `publish/subskills/publish-general/SUBSKILL.md` | 38 (a file card names a host path) | d | none |
| `publish/subskills/publish-bcca-book/SUBSKILL.md` | 130, 133 | c | cite |
| `publish/subskills/publish-bcca-factum/SUBSKILL.md` | 102, 105 | c | cite |
| `publish/subskills/publish-bcca-factum/SUBSKILL.md` | 50 | d | none |
| `publish/subskills/publish-vaniac-package/SUBSKILL.md` | 155 | c | cite |
| `publish/subskills/publish-vaniac-package/SUBSKILL.md` | 76 | d | none |
| `publish/subskills/publish-bcsc-form/SUBSKILL.md` | 246 | c | cite |
| `assemble/subskills/assemble-general/SUBSKILL.md` | 62 | c | cite |
| `assemble/subskills/assemble-vaniac-package/SUBSKILL.md` | 79, 108 | c | cite |
| `assemble/subskills/assemble-bcca-book/SUBSKILL.md` | 167 | c | cite |
| `assemble/subskills/assemble-affidavit/SUBSKILL.md` | 104 | c | cite |
| `assemble/subskills/assemble-affidavit/references/assembly.md` | 163 | c | cite |
| `case-data/operations/supersede-draft.md` | 304 | c | cite (`../../shared/present-files.md`) |
| `case-data/operations/ingest-unattended.md` | 33 | c | cite (`../../shared/present-files.md`) |
| `case-data/operations/ingest-verify.md`, `ingest-extract.md`, `verify-law.md`; `verify-law/SKILL.md` | `device_stage_files` for a subagent's read | d | none |
| `shared/legal-research.md` | 383, 400 | c | cite |
| `shared/legal-research.md` | 111 (`device_stage_files` for the agent's read) | d | none |
| `legal-research/SKILL.md` | 101 | c | cite |
| `shared/email.md` | 20 | c | cite |
| `task-prioritization/SKILL.md` | 63 | c | cite |
| `practice-data/SKILL.md` | 33 | c | cite |
| `review-proposition/SKILL.md` | 25, 29 | c | cite |
| `review-proposition/SKILL.md` | 10, 39 (card order; cards replaced by a line) | d | none |
| `drafting-data/SKILL.md` | 45 | c | cite |
| `drafting-data/SKILL.md` | 142 (render location history) | d | none |
| `drafting-data/references/jobs-stock.md` | 250 (a finding is never a file card) | d | none |
| `draft/references/reply.md` | 39, 73 | c | cite |
| `draft/references/reply.md` | 22 (cites `references/present-files.md`), 54 | a, d | none |
| `draft/references/letters.md` | 47, 112, 122, 140, 363 | c | cite |
| `draft/references/letters.md` | 132 (cites section 11 step 4), 78, 92 (present the mockup, section 11) | a | none |
| `draft/references/letters.md` | 94 (no file card for findings) | d | none |
| `draft/references/requisitions.md` | 10 | c | cite |
| `draft/references/job-session.md` | 171 | c | cite |
| `draft/references/job-session.md` | 117 (`SendUserMessage` for text) | d | none |
| `draft/references/dispatch.md` 46, `revise-on-the-fly.md` 17, `rule-migrate/SKILL.md` 35, `plugin-fix/SKILL.md` 39 | `SendUserMessage` for text | d | none |
| `draft/references/court-ready-assembly.md` | 4 | c | cite |
| `draft/references/counsel-review.md` | 25 | c | cite |
| `draft/references/counsel-review.md` | 27 (per `/show-me`) | a | none |
| `draft/references/assemble-then-gate.md` | 6, 12 | c | cite |
| `draft/references/new-matter-setup.md` | 30 | c | cite |
| `draft/references/new-matter-setup.md` | 14 (governed by `letters.md` 363) | a | none |
| `draft/references/delivery-check.md` | 42 (cites `references/present-files.md`), 47 (per `/show-me`) | a | none |
| `draft/references/loose-thread-triage.md` 28, `suggestion-box.md` 20 | cite section 11, View pages | a | none |
| `draft/references/CAN/BC/BCSC/Documents/notice-of-application.md` 40, `application-response.md` 42; `CAN/BC/BCCA/Documents/stay-response-book.md` 46, `respondent-factum.md` 40; `CAN/BC/_NoVenue/Documents/release.md` 45 | present as a file card | c | cite |
| `draft/User_Journeys/`: `work-the-worklist.md`, `witness-statement-to-signed.md`, `revise-by-asking-again.md`, `research-fills-the-open-slots.md`, `requisition-in-minutes.md`, `render-and-review-the-mockup.md`, `dead-end-decision.md`, `answer-the-other-side.md`, `a-better-copy-arrives.md`, `admissions-route.md`, `hold-it-in-reserve.md`, `offer-what-the-matter-already-knows.md`, `pick-up-where-you-left-off.md` | the assistant presents the mockup as a file card | c | cite once, at the first presenting step of each |
| `draft/User_Journeys/gate-before-filing.md` | 41 (illustrative `(file card: ...)` in a transcript) | d | none |
| `source/practice/mcp/src/schema-gen.ts` | 165 (`render_practice_board` description: "present practice_board_path as a file card") | c | none: §9 changes a tool description only where it ranks another route above `present_files`, and this names no route |
| `source/practice/mcp/src/submission/view-pages.ts` 12, `forms/matter-board-shell.ts` 14 | code comments | d | none |
| `source/practice/plugin.json` | 44 (hook matcher `SendUserFile`) | d | none: hooks out of scope |
| `show-me/SKILL.md` | all | n/a | related spec (landed c3a4b92) |
| hooks and tests (`show-me/hooks/staged-file-gate.py`, `drafting-data/hooks/*`, `source/practice/hooks/mail-send-gate.py`, tests) | | n/a | out of scope (§8) |
| `public/plugins/*/skills/` | no hit | none | none |

**Agents (§4.4).** No agent definition under `source/*/agents/` presents a file to the practitioner. `docket-clerk.md` says it cannot present under `/show-me` and returns open items to its caller. No allowlist change is needed.

**Residual risks needing a tool-side change (§4.5), not made here.**
- `source/practice/plugin.json` registers a hook on `SendUserFile` only, and `show-me/hooks/staged-file-gate.py` gates that route. No hook checks that `mcp__cowork__present_files` was preferred when both tools are listed.
- The `schema-gen.ts` tool descriptions say "file card" without naming the tool. They rely on the calling skill's citation.
- Whether `mcp__cowork__present_files` accepts a PC path on a remote-device host is not verified here. The rule sends such a session to the fallback only when the tool is absent.
