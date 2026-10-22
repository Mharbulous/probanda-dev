<!-- REGRESSION-PRONE: CanLII-first research has recurred repeatedly. See docs/design/2026-09-24 research-lawyer Westlaw-first fix plan.md before editing. Tests: legal-research/tests/. -->

# KeyCite Canada guide

How `citation-checker` reads Westlaw KeyCite Canada for one decision. Fetched by
`shared/citation-checker/note-up.md`. The agent definition's hard rules (the Chrome
reach ladder, the Westlaw access check, credentials, Out of Plan, the read boundary)
apply throughout.

Confirmed live on 2026-10-22, in one guided run on one decision that had no treatment.
Everything marked **OPEN** below has not been seen yet. When you meet it, believe what
you observe, record it as shown, and never guess.

## 1. Client ID

Run the client-matter gate of `shared/research-paralegal/westlaw-deep-research.md`,
Stage 2: its matching rule, the start-session page steps, the session-already-started
steps, and the "target not listed" rule, with the same stops and the same limit of 3
attempts. Fetch that file with the same tool. The start-session page may appear before
the Deep Research home: after sign-in, a citation link lands on the start-session page
with the last-used client ID pre-filled. Run the same steps there. Never look up a
citation under an unverified client ID.

## 2. The decision's page

Open the decision by citation deep link, URL-encoding the citation:

```
https://nextcanada.westlaw.com/Link/Document/FullText?findType=Y&cite=<url-encoded citation>&transitionType=Default&contextData=(sc.Default)
```

Before reading anything, check the page for Out of Plan indicators (an "Out of Plan"
badge, a pay-per-view or additional-charges notice). If any appears, dismiss it without
accepting a charge, and record KeyCite as `not run: out of plan`.

A citation the link does not resolve: search by party name once and use `find` on the
results. Still not found: record KeyCite as `not run: not found on Westlaw`.

The client ID shows in the top bar. Confirm it still matches before going on.

## 3. The flag

The KeyCite flag is the coloured letter immediately left of the case title. Its hover
tooltip reads `KeyCite <Colour> <Letter>`. Record the tooltip word for word. A
decision with no flag shown is recorded as `no flag shown`, never as a colour.

**OPEN:** whether the tooltip text can be read from the page (`find` or `read_page` on
the flag element) without a hover; the full flag legend.

## 4. Citing References

Clicking the flag opens Citing References, at a URL of this shape:

```
/Link/RelatedInformation/Flag?documentGuid=<the decision's GUID>&originationContext=docHeaderFlag
```

The tab row carries counts: `History (n) | Citing References (n) | Cited With (n) |
Legal Memos | Court Docs | Experts`. Record each label and count as shown.

The table's columns are `Treatment | Title | Date | Type | Depth | Abridgment
Classifications`, sorted by Treatment Type, with content-type filters on the left.
Record every row's six fields word for word, and mark a row `Out of Plan` when it
carries that badge. Open no row: the list is the record, and a row's document is a
citing decision you never read.

**OPEN:** the Treatment and Depth values of a treated decision, and whether they read
as text or show only as images (an image-only value is recorded as `shown as image`);
paging, or a cap on rows, for a heavily cited decision; a date filter or sort that
narrows the list to a `since` date.

## 5. History

Open the History tab and record each entry's fields as shown, or `none listed` when its
count is 0.

**OPEN:** the History tab with entries.

## 6. Export

**OPEN:** KeyCite's own export or delivery control for the Citing References list,
and its formats. Until a live run confirms one, record `Export: none`.
