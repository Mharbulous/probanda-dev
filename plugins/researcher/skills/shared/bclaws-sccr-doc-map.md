# BC Laws — SCCR document-ID map (source access only)

Where to find the text of the **Supreme Court Civil Rules** (BC Reg 168/2009) on bclaws, so a lookup costs one fetch instead of a guessing loop. This file carries **no rule content** — `shared/docket-clerk/references/bcsc-rules.md` remains SSOT for what the rules say.

Base URL: `https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/<doc-id>`

| doc-id | Contents |
|---|---|
| `168_2009_00` | Complete consolidation, Parts 1–25 (large — prefer a part document) |
| `168_2009_01` | Parts 1–9 |
| `168_2009_02` | Parts 10–20 |
| `168_2009_03` | Parts 21–24 |
| `168_2009_03_1` | Part 25 |
| `168_2009_04` | Appendix A — List of Forms |
| `168_2009_05` | Appendix B — Party and Party Costs |

Interpretation Act (RSBC 1996 c 238): `.../96238_01`.

## Access notes

- **Never guess a doc-id.** Pick the row whose Part range covers the rule (rule `N-x` sits in Part `N`), fetch it once, then locate the rule by heading search within the returned text.
- **Local sessions:** plain `curl` against these URLs works. **Prefer `curl` over `WebFetch`** — WebFetch truncates the larger part documents, and a truncated consolidation reads exactly like a rule that isn't there.
- **Cowork sandbox — a ladder, not a block.** bclaws is reachable from Cowork with the domain in the Capabilities allowlist (both `*.bclaws.gov.bc.ca` and the apex, no permission dialog, resolved 2026-08-03), but its bodies are unreliable: probes returned full-length bodies stamped about two years stale, a different stale stamp moments later, and an empty body from the apex. So, in order: (0) for a freshness check on a file that carries a source record, `sources__check`, which fetches on the practitioner's machine and returns currency facts only (`shared/docket-clerk/references/rule-freshness.md` § The fetch); (1) allowlisted `web_fetch`, which may refuse bclaws outright with `ROBOTS_DISALLOWED`, because bclaws' `robots.txt` admits only search-engine crawlers (observed 2026-10-06); (2) on a prompt, an empty body, or a body that fails the acceptance test below, the Chrome browser tools with the same direct URLs; (3) local `curl`, from a local session or through a device bridge to the practitioner's PC (`device_bash`).
- **Accepting a fetch (any rung, any session).** The session talking to the practitioner fetches, never a dispatched legal agent. Accept a body only if it holds the expected headings (the Part and rule headings, for a consolidation) **and** a `current to` date no older than the source on file (or, for the deadline rulesets, the last known-good reading). A plausible-looking but stale or truncated body is a failed rung, not a pass, so check the date, not just presence of content. If no rung passes, the source on file stands. Whenever a fetched stamp differs from the source on file, tell the practitioner both dates in one line. Replacing the saved copy is the practitioner's call.
- **Currency comes free with the part document.** Each part document carries both coarse freshness signals on its face — `current to <Month D, YYYY>` and `Last amended <date> by B.C. Reg. <n>/<yyyy>` (verified on `168_2009_01`, 2026-07-28). So a fetcher who already holds a part document discharges `statute-currency.md` leg 3 (source-on-file currency) from it, with no second fetch of the 345 KB TOC part `168_2009_00`.
- **Tracing when a rule changed.** Subrules carry their amendment attribution inline, e.g. `[am. B.C. Reg. 149/2022, Sch. 1, s. 4.]`. That names the amending regulation; the BC Gazette Part II page on bclaws for that reg (e.g. `v65n13_149-2022`) gives its deposit and in-force dates. Point-in-time (prior) versions are indexed separately — see `shared/docket-clerk/references/rule-freshness.md`, which owns the PIT/TLC document ids for all five governed enactments. (`free.bcpublications.ca` carries the Crown point-in-time PDFs as a redundant route if a bclaws PIT fetch fails.)

Doc-ids and Part ranges verified live 2026-07-19.
