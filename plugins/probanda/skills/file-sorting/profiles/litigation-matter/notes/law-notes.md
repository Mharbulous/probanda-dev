# Law folder notes (folder type 6)

Scope: legal authorities and research stored on the matter — case law,
statutes and regulations, secondary authority, books of authority, and
firm-authored memoranda of law.

## Codes typically used here

`ML` (memorandum of law). Look up definition in `code-registry.md`.

## Judgment calls

- **Stored case decisions** use a special naming format — no date prefix, no
  CODE component, no parenthetical: `[Neutral citation] [Short style of
  cause]`. The neutral citation is the identifier. Use `v` (no period).
  Examples:
  - `2019 BCSC 1101 Sahyoun v Lawson.doc`
  - `1993 CarswellBC 24 Shaughnessy v Roper.doc`
  - **Corporate-suffix drop rule.** Drop a **standalone designator token**
    (`Ltd`, `Inc`, `Corp`, `Corporation`, `LLC`, `LLP`, `PLC` — this list is
    exhaustive for gate purposes; an unlisted designator is a proposal-time
    judgment call) from the end of a name; use a well-known initialism if one
    exists (`CIBC v Tuckerr`). Entity-type wording that is a **substantive
    part of the party's name as it appears in the decision's caption** is
    never dropped — e.g. "Limited Partnership", "Law Corporation", "Private
    Limited", "& Supply Co." Expand an abbreviated form ("Ltd Partnership")
    to match the caption rather than dropping it. Designator vs. substantive
    is resolved by **reading the caption**, never guessed from the filename
    alone: at the name gate, a citation-form filename containing a listed
    token goes to the subagent for a one-time content check (the record gate
    remembers the verdict); one with no listed token passes without this
    judgment.
  - **Settled-citation-form carve-out.** Some case names are universally cited
    *with* the designator, and dropping it produces a name no one searching for
    the case would recognize. Before dropping a listed token, work this order
    and stop at the first source that answers:
    1. **Look in the same folder.** If another file that itself conforms to
       citation form already names the same decision — typically a
       parallel-citation copy — follow its treatment of the designator. Do not
       rename the sibling to match a mechanical drop.
    2. **Otherwise read the decision's own style-of-cause line** — the short
       case name the publisher prints as the document's title or in the
       headnote — in preference to the full cover-page caption. If that line
       keeps the designator, keep it.
    3. **Only if neither source settles it**, apply the drop rule above.
    Never resolve this from memory of how the case is "usually" cited: those
    two sources are the evidence. If they conflict with each other, leave the
    file on needs-manual-review and say which two forms disagree.
    This governs the *verdict* only — the token list stays exhaustive for gate
    purposes and the name gate still flags the file for the content check.
    Example: caption `RJR-MacDonald Inc. v. The Attorney General of Canada`,
    with a conforming parallel-citation copy of the same decision already in
    the folder that keeps `Inc` → `1994 CanLII 117 RJR-MacDonald Inc v Canada
    (AG).pdf`, not `1994 CanLII 117 RJR-MacDonald v Canada (AG).pdf`.
  Never add a parenthetical describing what the case stands for. A decision
  usually carries several ratios, and which one matters depends on the live
  issues in this matter — that is legal judgment, not a naming decision, and
  it does not belong in a file name.
- If a decision lacks a neutral citation (very old cases, tribunal decisions),
  use the dominant reporter citation in the same slot.
- **Superseded or reversed decisions.** Name the file from that document's own
  citation and style of cause, like any other decision — do not rename it to
  the higher court's citation and do not encode the subsequent treatment in
  the name. If the document is evidently a decision that was later reversed or
  overruled, flag it on needs-manual-review so the lawyer can decide whether
  the stored text should be replaced; never note the case up to find out.
- **`ML` subject:** name the legal issue (e.g. `ML limitation period s.6 LA`),
  not just "research memo."
- A firm memo discussing the law that sits here is `ML` (could equally live in
  Lawyer Brief, type 4) — not misfiled.

## Third-party AI research memos

External AI-generated research outputs (Alexi Instant Memos, Westlaw AI-Assisted
Research, Claude, and other AI tools) use a **source-name convention** — no CODE
component:

- `YYYY-MM-DD Alexi [topic].pdf` — Alexi Instant Memos
- `YYYY-MM-DD Westlaw [topic].pdf` — Westlaw AI-Assisted Research PDFs
- `YYYY-MM-DD Claude [topic].pdf` — Claude-generated research memos
- `YYYY-MM-DD [ToolName] [topic].pdf` — any other AI research tool (use the
  tool or model name as the source label, e.g. `ChatGPT`, `Copilot`)

The topic is a concise description of the research question (not "Instant Memo"
or "AI-Assisted Research" — those are already captured by the source name).
Do not use RPT for AI outputs — RPT is reserved for retained expert witnesses.

**Dating these files — don't trust the docx metadata.** Westlaw AI Deep
Research `.docx` exports carry templated `docProps/core.xml` created/modified
values that are not reliable per-document — two different memos generated in
the same session can show byte-for-byte identical core.xml dates. Instead,
open the document and read the timestamp printed in its own header text
(`Response generated: [Month DD, YYYY] at [time] UTC`), and convert that UTC
timestamp to Pacific local time (the firm's timezone) before using it as the
`YYYY-MM-DD` prefix — the UTC date is often one calendar day ahead of the
correct local date. **Some raw Westlaw exports carry no `Response generated:`
header at all** — only the static AI disclaimer. That is expected (seen
2026-07-27), not an anomaly to improvise around: file-system dates are
never acceptable, so the date is unconfirmed and the file goes on
needs-manual-review.

**Dating Alexi memos.** Alexi Instant/Pro Memos print their date in the
memo's own header block on page 1: the `Date:` line (e.g.
`Date: March 2, 2024`; newer exports may render the label and its `: value`
on separate lines). That is Alexi's memo date in plain form — use it as the
`YYYY-MM-DD` prefix as-is, no timezone conversion. The docx `core.xml`
metadata in Alexi exports is empty, and file-system dates are never
acceptable; a memo whose `Date:` line can't be read goes on
needs-manual-review.

**Alexi topic.** An Alexi memo answers one research question and states its
subject in the header's `Regarding:` line (e.g. `Regarding: Bad faith
damages`). Use the `Regarding:` text as the `[topic]` slot; if it is missing,
compress the `Issue`/`Question` section instead. Either way, name the legal
issue (consistent with the `ML` rule).
Examples:
- header `Date: March 2, 2024` + `Regarding: Necessity of naming owner as
  defendant` → `2024-03-02 Alexi necessity of naming owner as defendant.pdf`
- header `Date: December 15, 2023` + `Regarding: Bad faith damages` →
  `2023-12-15 Alexi bad faith damages.pdf`
- header `Date: March 4, 2025` + `Regarding: Reconciling arbitration clauses
  and court jurisdiction clauses` →
  `2025-03-04 Alexi reconciling arbitration and court jurisdiction clauses.pdf`

**Alexi export-name hints.** Raw exports are named
`Alexi_instant_memo_<first words>_<research id>` /
`Alexi_pro_memo_<first words>_<research id>` (.docx/.pdf) — always
non-conforming, and always renameable from the header block above. But
`Alexi_WeeklyReport_*.pdf` / `* Alexi Weekly (Activity) Report.pdf` and
`Alexi_Accounting_*.csv` are accounting/disbursement records, not research
memos — in the Law folder they are misfiled (type-(1) escape).

## Non-AI secondary authority distributed via a research platform

A memorandum, article, or abridgment authored by a human (a law firm, a legal
publisher) and merely *distributed* through Westlaw, CanLII, or a similar
platform is not an AI research memo — do not use the
`YYYY-MM-DD Westlaw [topic]` source-name convention for it. Instead treat it
as a memorandum of law: `YYYY-MM-DD ML re [topic].ext`, using the document's
own stated date (not the platform's access/update date, unless that's the
same thing) and naming the legal issue per the `ML` subject rule above.

Example: a Canadian Abridgment memorandum on invalidating a will, authored by
a law firm, distributed via Westlaw, dated (per its own "Updated Date" field)
1 January 2023 → `2023-01-01 ML re invalidating a will grounds BC.pdf`.

How to tell the two apart: an AI Deep Research output carries a
`Response generated: [timestamp]` header and no named human author. A
human-authored memo names its author (a firm or an individual) and typically
has its own title/date block rather than a generation timestamp.

## Arbitral institution rules

Procedural rules published by an arbitral institution use `RULES` as the CODE,
with the institution name and rule type in the subject slot:

`YYYY-MM-DD RULES [Institution] ([Type]).pdf`

Examples:
- `2022-07-12 RULES VanIAC (International Arbitration).pdf`
- `2022-07-12 RULES VanIAC (Domestic Arbitration).pdf`
- `2016-03-01 RULES ICC (International Arbitration).pdf`

## Known thin spots

No dedicated codes for: statute/regulation excerpts, books/briefs of
authorities, secondary authority (texts, articles) — except human-authored
memoranda distributed via a research platform, which are covered by the `ML`
rule above. Do NOT invent codes — leave on needs-manual-review and log
type-(2).

## Misfile test

Is the document a pleading, invoice, or letter? If yes, it's misfiled —
type-(1) escape.
