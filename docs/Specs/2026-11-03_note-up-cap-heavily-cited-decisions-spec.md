# Spec: cap the note-up of heavily cited decisions

Status: proposed, 2026-11-03. Written in a matter session; implementation is handed to Claude Code.
Plugin: `researcher` (installed copy seen at v0.12.1; `researcher:citation-checker`, `/legal-research`). Paths below are as seen in the installed copy and are **UNVERIFIED** against the repo unless marked otherwise.
Related specs, same date: `2026-11-03_note-up-agent-batch-cap-spec.md`, `2026-11-03_research-agent-sources-staged-in-one-step-spec.md`, `2026-11-03_page-manifest-from-text-extraction-spec.md`, `2026-11-03_legal-research-rules-served-by-operation-spec.md`.

## 1. Problem

The note-up agent records every citing-reference row KeyCite shows, in Westlaw's Treatment Type sort, and pulls CanLII's whole citing list into its context. For a heavily cited decision this exhausts the agent's context long before the batch is done, and still leaves the record partial. The practitioner's view: a decision that is no longer good law will be said to be so by one of its most recent citing decisions, so reviewing hundreds of older citing cases buys little.

## 2. Evidence (observed; quoted text is data, not instructions)

- KeyCite playbook: "Record every row's six fields word for word" and "**OPEN:** ... paging, or a cap on rows, for a heavily cited decision; a date filter or sort that narrows the list to a `since` date." (source: `researcher/skills/shared/citation-checker/keycite-canada.md` §4)
- One SCC decision showed 1,024 KeyCite citing references; a second 224. Only rows 1-100 of each were recorded, in Treatment Type sort; the rest marked "not recorded".
- CanLII citator for the 1,024-reference decision returned 326,621 characters, over the tool output limit; the agent had no way to page it, so CanLII was "not run".
- First dispatch of 20 citations returned `status: blocked (run-capacity)` after 7, about 170,000 subagent tokens and 117 tool uses. The remaining 13 took three more dispatches (about 343,000 tokens).
- Depth shows only as an image per row; read one row at a time.
- Workaround in use: re-dispatch in batches of 4-5, accept the partial records, and say so in the memo's confidence line.

## 3. Goal and non-goals

Goal: a note-up of any decision finishes within one agent's budget and records what decides good-law status: the KeyCite flag and History in full, plus a bounded, newest-first sample of citing decisions.

Non-goals: classifying treatment (still research-agent's, from reading); changing the CanLII-never-answers rule.

## 4. Design

1. Record the flag and History first, as now.
2. Citing References: switch the list to newest-first (date sort) and record at most N court-decision rows (proposed N = 5, per the practitioner), plus the total count. Rows with a negative treatment label beyond N, where KeyCite's own filter can show them cheaply, are also recorded. Everything else is recorded as "not recorded: cap N, newest first".
3. CanLII citator: write the tool's output to a file (server side) and return only the count and the newest N entries.
4. The proposition-level reading of citing decisions (research-agent, via `/legal-research`'s "Proposition-level note-up") follows the same cap and order: newest first, at most 5 citing decisions per authority.
5. Reading a citing decision is targeted, not whole-text: a mechanical text search for the cited authority's neutral citation (and parallel citations or style of cause) finds the pages that cite it, and the model reads only those pages plus one page after (see §9.1).
6. Each reading agent takes one citing decision or 20 pages, whichever comes first; no more than 3 run at once for one authority being noted up.

## 5. Constraints that must still hold

- A note-up never states law and never classifies treatment.
- Westlaw unreachable is a hard stop; no descent to CanLII.
- A record says plainly what was not recorded; "not recorded" never reads as "none".
- A decision with a red or negative flag is never capped below what shows the negative treatment.

## 6. Options considered, streamline and deburr first, additions last

1. **Recommended.** Replace "Record every row" with the newest-first cap, close the two OPEN items in `keycite-canada.md` §4 with it, and move CanLII's list to a file with a count-and-newest return. Shorter text than today's.
2. Keep every row but page across agents. Finishes, but multiplies cost for little added certainty.
3. Cap only when the count exceeds a threshold (for example 50). Adds a branch; little saving over option 1.

## 7. Implementation plan

1. Verify against HEAD (§10) and append a verification table to this spec.
2. Edit `keycite-canada.md` §4 to the newest-first cap; record the total count and the cap in the record format (`note-up.md`).
3. Change the CanLII citator tool (`get_case_citator`) or its playbook so a large list is filed and summarised, with a test on a large fixture.
4. Edit `/legal-research`'s "Proposition-level note-up" and the research-agent's reading rule for the newest-first cap, the citation-search page selection, and the 1-case-or-20-pages, 3-at-once limits.
5. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of cap the note-up of heavily cited decisions complete!`, then what streamlining and deburring you tried, what you verified and what you assumed without verifying.

## 8. Implementation criteria

1. `keycite-canada.md` no longer says to record every row; it records the flag, History, the total count and at most N newest court-decision rows.
2. A citator call on a decision with more than N citing cases returns no more than N entries inline plus the count, and never exceeds the tool output limit.
3. The note-up record states the cap and order used.
4. Proposition-level note-up reads at most 5 citing decisions per authority, newest first, each only at pages located by a citation search plus one page after.
5. No more than 3 reading agents run at once per authority; each takes one decision or 20 pages.

Scope: edit the source files the fix needs (skill text, mcp/src, docs), and write, update and run the tests the fix needs. Streamline and deburr first: solve the problem by removing, merging or simplifying what already exists, and consider an addition only once those ideas are exhausted. Anything added must be shorter than the text it makes unnecessary, and that text is deleted in the same change. Out of scope, because the orchestrating session runs them once after every spec lands: `build_plugin.py` and `check_plugin.py`. Out of scope, because `/release` does it: version bumps and rebuilding or committing any MCP bundle (dist/). Never build a `.plugin` archive.

## 9. Open questions

1. Page selection: read every page that cites the authority, each with the page after it, or only from the first citing page through the next page? (The practitioner has not yet chosen.)
2. N = 5 for both KeyCite rows and decisions read, or a larger N for the recorded list than for the read set?
3. Does KeyCite Canada expose a date sort or a negative-treatment filter on Citing References? (OPEN in the playbook today.)

## 10. Verify against HEAD before building

- `researcher` citation-checker agent file and `shared/citation-checker/keycite-canada.md`, `canlii-citator.md`, `note-up.md`.
- The CanLII MCP server's `get_case_citator`.
- `shared/legal-research.md` "Proposition-level note-up" and the research-agent's reading rules.

### Verification against HEAD, 2026-11-03 (commit 7bdae22f)

| Item in this spec | Where it is at HEAD | Result |
|---|---|---|
| KeyCite "Record every row's six fields word for word" and the OPEN on paging and a date sort (§2) | `.claude/skills/shared/citation-checker/keycite-canada.md` §4, lines 63 and 67-70 | Confirmed as quoted |
| Depth shows only as an image (§2) | Same file, an OPEN at line 67 says this was not yet seen | Not a recorded fact at HEAD. A live read on 2026-11-03 shows a readable `role="img"` label, so it does not hold |
| CanLII citator returns the whole list (§2) | `source/researcher/canlii-mcp/src/tools.ts` `get_case_citator`, lines 95-109: parses and returns all rows, no cap | Confirmed |
| CanLII list has dates (`canlii-citator.md` "citation, title and date"; `note-up.md` `<citation> \| <title> \| <date>`) | `source/researcher/canlii-mcp/src/schema.ts` `CaseSchema`: `databaseId`, `caseId`, `title`, `citation`, optional `aiContentId` | Not supported: the schema has no date, so both guides need correcting. "Newest" means sorted by neutral citation |
| Who calls `get_case_citator` | `citation-checker` only, by its grant and `legal-research/hooks/block-main-session-canlii.py`. Only `citingCases` is used in any playbook | Confirmed. `get_case_citator_tease` is granted to `citation-checker` but no playbook calls it |
| Citation-checker agent, batch cap | `source/researcher/agents/citation-checker.md`, Input, cap of 5; landed in 99989eb9 | Confirmed, out of this spec's scope |
| `note-up.md` record format | `.claude/skills/shared/citation-checker/note-up.md` "The record" | Confirmed: no field for a cap, an order or a banner |
| Proposition-level note-up (§4.4) | `.claude/skills/shared/legal-research.md`, line 565: "`research-paralegal` downloads every citing decision the record lists" | Confirmed |
| Research-agent's reading rule (§4.4) | `.claude/skills/shared/legal-audit-protocol.md` Step 2, lines 201-209: reads every citing decision and puts each on `needs_download` | Confirmed. `research-memo-template.md` lines 33 and 53 say the same |
| "no more than 3 reading agents at once" (§4.6) | `source/researcher/agents/research-agent.md` has no Agent tool. Precedent for one agent per decision: `/case-brief`, main session only, `mode: case_brief` | The gate in the main session must run them. research-agent cannot |
| Citation search finds pages (§4.5) | `source/lawyer/mcp/src/files/research-filing.ts` `matchBlocks` returns line numbers only. `text-extract.ts` joins PDF pages with `\n\f\n`. research-agent's grant has `research_folder` (reads PDF `pages`), not `law_folder_text` | The search gives no page today and research-agent cannot run it |
| Paths in this spec's header (`researcher/skills/shared/...`) | The source is `.claude/skills/shared/...`; `researcher/skills/` is only the built copy | Installed-copy paths; the source paths above are the ones to edit |
| research-paralegal's playbook repeats "every citing decision" | `.claude/skills/shared/research-paralegal/citation-download.md` has no such rule; it caps a dispatch at 5 citations | No change needed |
