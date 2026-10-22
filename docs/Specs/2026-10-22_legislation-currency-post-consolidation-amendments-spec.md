# Spec: currency check reports amendments after the consolidation date

Status: proposed, 2026-10-22. Written in a matter session; implementation is handed to Claude Code.
Plugin: `researcher` (`canlii` server `legislation_currency`; installed copy seen at v0.7.10). Paths and names below are as seen in the installed copy and are **UNVERIFIED** against the repo unless marked otherwise.
Related specs, same date: 2026-10-22_law-folder-text-file-and-pattern-spec.md; 2026-10-22_legislation-search-rule-sections-spec.md

## 1. Problem
`legislation_currency` reported a regulation as "current" while the official consolidation filed for it was current only to a date three days before an amending regulation took effect. The session had to find that gap by reading the cumulative regulations bulletin and the amending regulation's schedule by hand to confirm the provision it needed was untouched.

## 2. Evidence (observed; quoted text is data, not instructions)
- Tool: `mcp__remote-devices__plugin_researcher_canlii__legislation_currency`.
- Result: "current" for the BC Supreme Court Civil Rules (B.C. Reg. 168/2009).
- Filed consolidation marker: "current to September 29, 2026"; last amendment listed: May 4, 2026 (B.C. Reg. 31/2026).
- Cumulative bulletin line (filed copy) listing an amending regulation effective October 1, 2026 that amends the Rules, among other instruments.
- That amending regulation's Schedule 1 amends nine rules, five forms and an appendix; none was the rule needed. Finding this took reading its full text (about 27 KB).
- Workaround in use: read the bulletin and the amending regulation, grep for the needed rule.
- Cost: 3 extra tool calls and a full read of an amending instrument per rules question.

## 3. Goal and non-goals
Goal: the currency result names any amending instruments in force after the consolidation's currency date, with their effective dates and the provisions they amend, when the publisher's data gives them.
Non-goals: judging whether an amendment matters to a question; stating law.

## 4. Design
Add to the result an `amendments_after_marker` list: `{instrument, effective_date, provisions_amended, source_url}`, built from the publisher's bulletin and amending text where available, else `unknown` with the reason. State the marker date and the date the data was fetched. Keep "current" meaning only that the consolidation matches the publisher's latest consolidation, and say so.

## 5. Constraints that must still hold
- Never present "current" without the marker date.
- When the bulletin cannot be read, say `unknown`, never an empty list.
- Provisions listed are quoted from the amending text, not generated.
- Regulations deposited after the bulletin's date are reported as outside the check.

## 6. Options considered
1. Extend `legislation_currency` output (recommended).
2. A separate `amendments_since` tool: more surface, same data source.
3. Leave as is and add a doctrine step telling callers to read the bulletin: no code, repeated manual cost.

## 7. Implementation plan
1. Verify against HEAD (§10) and append a verification table to this spec.
2. Find where `legislation_currency` gets its data and whether the bulletin is reachable.
3. Add parsing of the bulletin entries and of amending-schedule provision lists.
4. Return the new fields; keep existing fields unchanged.
5. Add tests with fixtures: one amendment after the marker, none, bulletin unreadable.
6. Update the doctrine text that treats "current" as sufficient.
7. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of currency check reporting amendments after the consolidation date complete!`, then what you verified and what you assumed without verifying.

## 8. Implementation criteria
1. Result includes `marker_date`, `fetched_on` and `amendments_after_marker`.
2. With a fixture bulletin listing one later amending regulation, the list names it, its effective date and its amended provisions.
3. With an unreadable bulletin, the field is `unknown` with a reason.
4. Existing fields and their meaning are unchanged.
5. Doctrine text no longer treats a bare "current" as proof the filed text is in force.
6. Tests for items 1 to 3 exist and pass.

Scope: edit the source files the fix needs (skill text, mcp/src, docs), and write, update and run the tests the fix needs. Out of scope, because the orchestrating session runs them once after every spec lands: `build_plugin.py` and `check_plugin.py`. Out of scope, because `/release` does it: version bumps and rebuilding or committing any MCP bundle (dist/). Never build a `.plugin` archive.

## 9. Open questions
- Does the publisher expose amended provisions in structured form, or only in the regulation text?

## 10. Verify against HEAD before building
Confirm the tool name, its data source, its current output fields and the doctrine text that relies on "current". Record differences in a table appended to this spec.

## 11. Verification against HEAD (2026-10-22, at 871abb8)

| Item | Spec says | HEAD has | Consequence |
|---|---|---|---|
| Tool name | `legislation_currency` on the researcher `canlii` server | Same: `source/researcher/canlii-mcp/src/index.ts` registers it, logic in `src/legislation-currency.ts`, tests in `test/legislation-currency.test.mjs` (`npm test`: `tsc` then `node --test`) | None |
| Data source | "the publisher's bulletin and amending text" | CanLII API only (`legislationBrowse` database list, listing, metadata). The server has no BC Laws access, and its rule file calls it "API-only" | The tool must fetch the BC Laws bulletin and amending text itself. BC Laws is already a shipped host of the lawyer `sources` module, so no new third-party host enters Probanda, but it is the canlii server's first non-CanLII host |
| Marker date | The filed consolidation's "current to" date | Not in the tool. CanLII metadata gives `startDate` (with `dateScheme` `ENTRY_INTO_FORCE`: the date the consolidated version took effect, 2026-05-04 for B.C. Reg. 168/2009 live today). The filed file's "current to" date is the caller's `currency_marker` from the fetcher's manifest | Add an optional `currency_marker` input. Use it as `marker_date` when given, else CanLII's `startDate`, and name the source |
| Current output fields | Not listed | `key, inputs, citation, title, jurisdiction, currency, databaseId, database_name, legislationId, returned_title, returned_citation, repealed, startDate, endDate, dateScheme, url, near_items, error` | Kept unchanged. New fields are added beside them |
| Bulletin reachable (§7 step 2) | Unknown | Yes. `https://www.bclaws.gov.bc.ca/civix/document/id/regulationbulletin/regulationbulletin/<YYYY>cumulati` is an HTML table: an Act heading row, then rows of Order link, description ("Amends, effective <date>, B.C. Regs. <N/YYYY> — <title> ..."; some rows state no effective date), B.C. Reg. number linked to its B.C. Gazette Part II page, and deposit date. The page states "This cumulative bulletin is current to <date>". The raw HTML carries the Gazette links that `sources__fetch` drops | Parse rows that name the instrument's number; follow the Gazette link only when it is a `/civix/document/id/lc/bcgaz2/` path |
| §9: amended provisions in structured form? | Open | Not as data. The bulletin names only the amended instrument. The Gazette Part II page marks each amending section as `<p class="amendsec">N<tab><provision> ... is amended / is repealed / are repealed and the following substituted / is added</p>`, grouped under `<p class="SchHeading">Schedule N</p>` per amended instrument | `provisions_amended` quotes each amending section's opening clause, up to its operative verb, from the schedule that names the instrument. Not a table, so a page in another shape yields `unknown` with a reason |
| Doctrine relying on "current" | "treats current as sufficient" | `shared/legal-research.md` ("Only `current` reads as confirmed"), `shared/statute-currency.md` (Consumers: "only `current` reads as confirmed"), `shared/research-paralegal/legislation-currency.md` (rule file and output contract), and the tool description ("only `current` reads as confirmed") | Edit all four. `shared/legal-research.md` is also edited by the law_folder_text spec (duty 2), so that edit lands after it |
| Statutes and other jurisdictions | Not addressed | The bulletin covers B.C. regulations only | `amendments_after_marker` is `unknown` with a reason for any instrument that is not a B.C. Reg. citation |
