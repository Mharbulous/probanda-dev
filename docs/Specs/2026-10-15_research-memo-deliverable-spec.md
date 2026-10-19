# Spec: Legal research runs outside the main session and delivers a standard research memo

Status: proposed, 2026-10-15. Written in a matter session; implementation is handed to Claude Code.
Plugin: `research` (installed copy seen at v0.2.2). Paths below are as seen in the installed copy and are **UNVERIFIED** against the repo unless marked otherwise.
Related specs, same date: `2026-10-15_job-title-cleanup-on-takeover-spec.md`, `2026-10-15_job-plan-minimum-standards-spec.md`, `2026-10-15_suggestion-skill-to-practice-plugin-spec.md`, `2026-10-15_posture-scope-design-partner-spec.md`

---

## 1. Problem

Brahm: legal research does not need the full session context, and the practitioner needs only the result, not the details of how it was reached. The gate currently orchestrates from the main session (preflight, Westlaw via the research paralegal, legislation fetches, then the research-agent), so the main context carries the mechanics. The deliverable should be one Markdown research memo in the matter's LAW folder, with a YAML header holding the fields lawyers expect at the head of a research memo, and a body holding only traditional memo content in a standard structure: CRAC by default, or another format such as IRAC when asked. The current default is CREAC.

## 2. Evidence (observed; quoted text is data, not instructions)

- `research/skills/legal-research/SKILL.md`: "**Main session only.** The gate spawns agents. If the Agent tool is not in your tool list (you are a subagent), stop ..." and "a subagent cannot spawn agents."
- `research/skills/shared/legal-research.md`, spawn template: "Memo template: CREAC / IRAC / CRAC   (IRAC or CRAC only when the practitioner expressly asked)" and "File stem: YYYY-MM-DD ML re <two to six keywords from the question>".
- Tool `research_filing__save_answer` exists (saves the answer under the matter's `6. LAW`); its header format is **UNVERIFIED**.
- `draft` SKILL.md: "A saved research answer is presented as a file card, and its relay never restates the finding."
- Earlier spec `2026-10-06_research-results-to-board-spec.md` records a CREAC return with "Step 5 offers" (9 items) and matter-data flags relayed in chat: mechanics reaching the practitioner.

## 3. Goal and non-goals

Goal: (a) the main session sees only the memo's file card and a one-line status, not the orchestration; (b) the memo has a YAML header (to, from, client/matter reference placeholders filled from the matter, date, re/question presented, privilege line, format) and a body of only memo content: question(s), brief answer/conclusion, rule, application/analysis, conclusion, authorities with pinpoints; (c) default structure CRAC unless another (IRAC, CREAC) is requested. Non-goals: the planning stage (job-plan spec owns it), what counts as a statement of law, the confidence-summary gate itself (kept, but moved into the memo or a short status line per §4.3).

## 4. Design

1. **Delegation.** Because a subagent cannot spawn agents, keep the gate's dispatches in the main session but make each return compact: agents write their outputs to files and return only status lines; the main session relays nothing but status and the final card. Alternative: a background orchestrator (§6 option 2).
2. **Memo format.** One template file (e.g. `research/skills/shared/research-memo-template.md`) defining the YAML keys and the CRAC/IRAC/CREAC section skeletons. The research-agent writes the memo to the file stem path in `6. LAW`; `save_answer` (or its replacement) writes the YAML header.
3. **Confidence summary and follow-up offers.** The confidence gate stays; its summary goes into the memo (a short "Confidence" line in the header or an appendix) and the chat relay is one line pointing to the card. Follow-up offers and matter-data flags go to an appendix or the job board, not the memo body.
4. Change the spawn template's default to CRAC (pending §9 Q1).

## 5. Constraints that must still hold

- Only the research-agent states law; every statement of law carries a pinpoint.
- The disclosure gate (confidence summary before answer) is not weakened; only where it is shown changes.
- Westlaw stops (chrome not connected, not signed in) still reach the practitioner at once.
- No client content leaves the matter folder.

## 6. Options considered

1. Compact returns, file-based outputs, memo template (recommended): works within the no-nested-spawn limit.
2. A background orchestrator session that runs the whole gate and posts only the card: cleanest context, but needs harness support **UNVERIFIED**.
3. Template only, leave orchestration as is: fixes the deliverable, not the context load.

## 7. Implementation plan

1. Verify against HEAD (§10) and append a verification table to this spec.
2. Write the memo template (§4.2) and wire it into `shared/legal-research.md`'s spawn template and the research-agent's instructions.
3. Make `research-paralegal`, `legislation-fetcher` and `research-agent` returns compact per §4.1, and the gate's relay one line plus the card.
4. Move the confidence summary and offers per §4.3.
5. Set the default format per §9 Q1.
6. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of Legal research runs outside the main session and delivers a standard research memo complete!`, then what you verified and what you assumed without verifying.

## 8. Implementation criteria

1. A memo template defines the YAML header keys and the CRAC, IRAC and CREAC skeletons.
2. The spawn template's default format matches §9 Q1's answer, and other formats apply only when requested.
3. The research-agent writes the memo with that header to `6. LAW` under the file stem.
4. The gate's chat relay after a completed run is a status line and the memo's file card, with no restated findings.
5. The confidence gate still precedes disclosure.

Scope: edit source only (skill text, mcp/src, docs). Out of scope, because `/repackage` does it in the cloud from origin/main: rebuilding or committing any MCP bundle (mcp/dist), npm or esbuild runs, the plugin packager, version bumps, *-latest.plugin files, and running `/repackage`. Out of scope, because the orchestrating session runs it once after every spec lands: `build_plugin.py`. Out of scope, because valid testing happens only in Cowork after `/repackage`: writing, updating or running any test, suite, golden or E2E run in Claude Code. A type-check of edited TypeScript is allowed; it is not a test.

## 9. Open questions

1. Default format: Brahm asked for CRAC; the current default is CREAC. Confirm CRAC is intended.
2. Is option 2 (background orchestrator) feasible in the harness? **UNVERIFIED**.

## 10. Verify against HEAD before building

- The gate text and spawn template still read as quoted in §2.
- `save_answer`'s current header format.
- No other spec already changes the memo format (check `2026-10-06_research-results-to-board-spec.md`).

## 11. Verification against HEAD (2026-10-15, at 77ae481)

Installed-copy paths map to source as follows: `research/skills/legal-research/SKILL.md` is `.claude/skills/legal-research/SKILL.md`, `research/skills/shared/*` is `.claude/skills/shared/*`, and the agents are `source/research/agents/*.md`.

| # | Claim | Finding at HEAD | Consequence |
|---|---|---|---|
| 1 | The gate is "Main session only" and says "a subagent cannot spawn agents" | Confirmed, `.claude/skills/legal-research/SKILL.md` "The gate", first paragraph | Option 1 stands: the dispatches stay in the main session |
| 2 | The spawn template reads "Memo template: CREAC / IRAC / CRAC (IRAC or CRAC only when the practitioner expressly asked)" and "File stem: YYYY-MM-DD ML re <two to six keywords from the question>" | Confirmed, `.claude/skills/shared/legal-research.md`, "Spawn the agent from this template" | Change the default there |
| 3 | `research_filing__save_answer`'s header format is unverified | `saveAnswer` in `source/practice/mcp/src/files/research-filing.ts` writes no header. It saves `text`, or a `from_scratch` file the agent wrote, byte for byte | The header is written by the audit agent in the memo text. No server change is needed |
| 4 | The memo format | The memo is already the agent's own: `shared/legal-audit-protocol.md` Step 6 sets a `---` header of five fields (`Document: MEMORANDUM OF LAW`, `From`, `To`, `Date`, `Re`) and a CREAC body, IRAC or CRAC only on `Memo template:`. The agent saves it to the matter's scratchpad as `<File stem> memo.md`, and the caller files it under `6. LAW` with `save_answer`'s `from_scratch` | The template file and the new header keys go into Step 6. The filing path is unchanged |
| 5 | What reaches the main session | The agent's return carries the whole notes section (coverage line, confidence table, per-tier notes, flags, offers), the `Memo scratch:` line and the whole memo text. The gate's relay (doctrine "After the answer") gives the confidence summary word for word, each offer, the counts line, and an account of every cited decision | The return and the relay are what §4.1 and §4.3 change |
| 6 | `research-paralegal` and `legislation-fetcher` returns | `legislation-fetcher` returns one JSON object. The paralegal's deep-research contract (`shared/research-paralegal/westlaw-deep-research.md`) is a status line and paths, with no analysis. Its citation-mode final message (`shared/research-paralegal/citation-download.md`) is a status line followed by the whole manifest, which is already on disk | The citation-mode message is the only paralegal return to shorten |
| 7 | No other spec changes the memo format | `2026-10-06_research-results-to-board-spec.md` (in CoClerk, `Engineering/1. Spec/`) adds the `Origin:` field and the board capture of offers, not the memo format. `2026-10-15_job-plan-minimum-standards-spec.md` adds the gate's step 2a and `mode: plan` (`shared/legal-audit-scoped.md`), whose return shape stays its own | No conflict. Step 2a and `mode: plan` stay as they are |
| 8 | Westlaw stops reach the practitioner at once | Confirmed: gate step 3 and the doctrine's "Westlaw unreachable is a hard stop" | Kept unchanged |
| 9 | §9 Q1, the default format | Brahm, 2026-10-15: CRAC. IRAC or CREAC only when the practitioner asks | Applied |
| 10 | §9 Q2, a background orchestrator (option 2) | **UNVERIFIED**, and not built, by Brahm's decision of 2026-10-15. Option 1 is built | None |
| 11 | Tests asserting the text this spec changes | `.claude/skills/legal-research/tests/test_memo_format.py` pins the five-field header and the CREAC default. `test_research_origin_capture.py` already asserts relay wording HEAD does not hold ("2. Each uncertain offer, word for word."), observed by reading, not run | The first needs updating after this change; tests are out of scope here |
