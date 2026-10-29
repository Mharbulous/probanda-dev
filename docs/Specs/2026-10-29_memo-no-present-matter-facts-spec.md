# Spec: research memos must carry no facts or identifiers of the working matter

Status: proposed, 2026-10-29. Written in a matter session; implementation is handed to Claude Code.
Plugin: `researcher` (installed copy seen at v0.10.13). Paths below are as seen in the installed copy and are **UNVERIFIED** against the repo unless marked otherwise.
Related specs, same date: 2026-10-29_memo-layout-sections-and-sources-spec.md

## 1. Problem
A research memo returned by `researcher:research-agent` carries identifiers and facts of the matter it was written for: the header names the matter number and the practitioner and carries a Privilege field, and the Application section states facts of the working matter beside the authorities' facts. The practitioner wants every memo generic: no identifying facts and nothing linking it to a matter. Application discusses only the facts of the authorities cited. There is no Facts section and no second, public form, because the matter's facts belong in the matter's case data only (single source of truth) and a summary in a memo would drift from it. A generic memo can also be shared.

## 2. Evidence (observed; quoted text is data, not instructions)
- Memo header as returned: `Privilege: PRIVILEGED AND CONFIDENTIAL`, `To: <practitioner name>`, `Matter: "MATTER_NO"`, with `From:`, `Date:`, `Re:` and `Format:`.
- The gate's doctrine: "`Matter:` is the same file number duty 4 passes the fetcher, which the memo's header carries." (source: researcher `shared/legal-research.md`, below the spawn template). The same template passes `Facts: <the factual context>`, `Asked by: <the practitioner's name>` and `Origin: ... "<the draft's words the question came from>"` to the agent.
- Application section as returned: the line "Applying this law to the matter's own facts is `/apply-to-facts`'s job. What follows only compares the authorities' facts with the facts given.", then, under one authority, a bullet beginning "Here," that stated the kind of application before the court, the method and date of service of its notice of hearing, and the hearing date.
- Workaround in use: a hand edit that deletes the three header fields, the boilerplate line and the "Here," bullet. Nothing else changes.

## 3. Goal and non-goals
Goal: a memo states no fact of the working matter and nothing identifying it: no matter number, party, counsel or practitioner name, privilege label, date, amount, document or fact pattern. Application describes only the facts of the cited authorities. Issue and Conclusion are phrased generally.
Non-goals: a Facts section; privileged and public forms of one memo; section order and Sources (sibling spec); applying law to the matter's facts (the `/apply-to-facts` skill still does that).

## 4. Design
Header keeps `Document`, `From`, `Date`, `Re` and `Format` (and Confidence where the layout has it); it drops `Matter`, `To` and `Privilege`. In the agent's text, add one rule: the `Facts`, `Matter`, `Asked by` and `Origin` inputs are for choosing authorities and routing only, and the memo never states, summarises or alludes to them. Replace the boilerplate sentence with a rule that Application describes only the facts of the cited authorities and may say which authority's facts come closest to a stated generic pattern. In `shared/legal-research.md`, change the sentence saying the memo's header carries the matter number. The matter number is still passed to the fetcher, which needs it.

## 5. Constraints that must still hold
- The agent still receives `Facts` so it can choose analogous authorities; the spawn template does not lose the field.
- The fetcher dispatch still receives the matter file number.
- Nothing is stripped by the caller: the memo is saved verbatim, so the agent's output must already be clean.
- No Facts section, and no privileged/public pair, is introduced.
- Quotations from authorities, citations and pinpoints are unchanged.

## 6. Options considered (streamline and deburr first, additions last)
1. Edit the agent text and the one doctrine sentence per §4: remove header fields and the boilerplate line, add the one never-state rule. Net text should be shorter. (recommended)
2. Also add a caller-side scan of the returned memo for the matter's party, counsel and practitioner names and matter number before saving. Catches slips; adds code and reads matter data on each return; blocks only on a hit.
3. Strip identifiers in the caller after return. Conflicts with save-verbatim and cannot find paraphrased facts.

## 7. Implementation plan
1. Verify against HEAD (§10) and append a verification table to this spec.
2. Find where the header fields and the Application boilerplate are produced (the research-agent definition, any memo-layout reference) and every reader of `Matter:` or `Privilege:` in a memo header (file-stem logic, `/matter-data`, citation scans, tests).
3. Edit per option 1. Update every reader found, in the same change.
4. If §9 chooses option 2, add the scan as the smallest script or tool call the plugin already has a place for.
5. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of research memos must carry no facts or identifiers of the working matter complete!`, then what streamlining and deburring you tried, what you verified and what you assumed without verifying.

## 8. Implementation criteria
1. The memo header layout in the agent text lists no `Matter`, `To` or `Privilege` field, and no other text tells the agent to print them.
2. The agent text says the `Facts`, `Matter`, `Asked by` and `Origin` inputs are never stated, summarised or alluded to in the memo.
3. The sentence about applying the law to "the matter's own facts" is gone, and Application is defined as the facts of the cited authorities only, with no "Here," comparison to the working matter.
4. Issue and Conclusion are required to be phrased without party names, dates, amounts, matter numbers, document names or the fact pattern of the working matter.
5. `shared/legal-research.md` no longer says the memo's header carries the matter number; the fetcher dispatch still passes it.
6. No Facts section and no second memo form exist anywhere in the layout text.
7. Every reader of the old header fields found at step 2 is updated; the plugin's tests pass; one test fails on a fixture memo that carries a `Matter:` line if tests already cover the header.

Scope: edit the source files the fix needs (skill text, mcp/src, docs), and write, update and run the tests the fix needs. Streamline and deburr first: solve the problem by removing, merging or simplifying what already exists, and consider an addition only once those ideas are exhausted. Anything added must be shorter than the text it makes unnecessary, and that text is deleted in the same change. Out of scope, because the orchestrating session runs them once after every spec lands: `build_plugin.py` and `check_plugin.py`. Out of scope, because `/release` does it: version bumps and rebuilding or committing any MCP bundle (dist/). Never build a `.plugin` archive.

## 9. Open questions
- Is text alone enough, or add the caller-side identifier scan (option 2)? The practitioner's position is that the memo is generic by construction; a scan is a safety net with a code cost. Ask Brahm.
- Memos already saved in matter folders keep their old headers. Leave them, or offer a one-off cleanup? Ask Brahm.

## 10. Verify against HEAD before building
- Confirm the three header fields and the boilerplate Application sentence are produced by text in the plugin, and where.
- Confirm the quoted sentence in `shared/legal-research.md` and every reader of the memo header fields.
- Confirm the sibling spec's edits (section names and order, Sources) do not touch the same paragraphs; this spec edits the header, the Application paragraph and the never-state rule.

## 11. Verification against HEAD (b2a87777), 2026-10-29

| Spec claim | HEAD | Result |
|---|---|---|
| Header fields produced by plugin text | `.claude/skills/shared/research-memo-template.md` lines 14, 15 and 17 print `Privilege:`, `To:` (the spawn prompt's Asked by) and `Matter:` (the spawn prompt's Matter). `source/researcher/agents/research-agent.md` holds no header, layout or Facts text | Present; path corrected |
| Boilerplate Application sentence produced by plugin text | `shared/legal-audit-protocol.md` Step 6, Application bullet: compares each authority's facts "with the spawn prompt's `Facts:`", then "Say in one sentence that applying the law to the matter's own facts is `/apply-to-facts`'s job". No text asks for a "Here," bullet; it follows from comparing with `Facts:` | Present; the bullet is a product of the comparison rule |
| Quoted sentence in `shared/legal-research.md` | Present below the spawn template: "`Matter:` is the same file number duty 4 passes the fetcher, which the memo's header carries." The template still passes `Facts`, `Matter`, `Asked by` and `Origin` | Present |
| Readers of `Matter:`, `To:`, `Privilege:` in a memo header | No code or skill parses them. `saveAnswer` (`source/lawyer/mcp/src/files/research-filing.ts`) copies the memo's bytes and only swaps the legend. `research-filing.unit.test.mjs` uses a memo with `Document` and `Re` only. `draft/references/job-session.md`, `matter-data`, `verify-law`, `scripts/` read none. Only `legal-research/tests/test_memo_format.py` pins the old header (`HEADER`) and the old Application wording | Listed; one test to update |
| `Origin` words in the memo | They reach the notes file (`origin-correction` lines), not the memo | Notes are outside this spec |
| Sibling spec overlap | The layout spec's section names, order, bold Issue, one-paragraph Conclusion and prose Application stay as they are. This change edits the header block, the Step 6 Application bullet and the `legal-research.md` sentence | No shared paragraph |
