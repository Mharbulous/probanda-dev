<!-- REGRESSION-PRONE: CanLII-first research has recurred repeatedly. See docs/design/2026-09-24 research-lawyer Westlaw-first fix plan.md before editing. Tests: legal-research/tests/. -->

# KeyCite Canada guide

How `citation-checker` reads Westlaw KeyCite Canada for one decision. Fetched by
`shared/citation-checker/note-up.md`. The agent definition's hard rules (the Chrome
reach ladder, the Westlaw access check, credentials, Out of Plan, the read boundary)
apply throughout.

Confirmed live on 2026-10-22 on one decision with no treatment, and on 2026-11-03 on one
heavily cited decision, where the product was labelled "Westlaw Advantage Canada".
Everything marked **OPEN** below has not been seen yet. When you meet anything else,
believe what you observe, record it as shown, and never guess.

A note-up never decides which labels are negative. Every label below is KeyCite's own,
recorded word for word.

## 1. Client ID

Run the client-matter gate of `shared/law-getter/westlaw-deep-research.md`,
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

The KeyCite flag sits immediately left of the case title and reads as text without a
hover (`read_page` or `find`): its image alt is `KeyCite <Colour> Flag`. Record it word
for word. A decision with no flag shown is recorded as `no flag shown`, never as a colour.

The decision may carry a `KeyCite treatment` banner: `Most Negative Treatment: <label>`,
then `Most Recent <label>: <title> | <citations> | (<court>, <date>)`. Record it word for
word, or `no banner shown`.

**OPEN:** the full flag legend.

## 4. History

The tab row carries counts: `History (n) | Citing References (n) | Cited With (n) |
Legal Memos (n) | Court Docs (n) | Experts (n)`. Record each label and count as shown.

Open the History tab, `Direct History (n)`, with a graphic view at the top. Record every
entry as shown, with no cap: its title, citation, court and date, and its relationship
phrase where it has one (`Affirmed by`). Record `none listed` when the count is 0.

## 5. Citing References

Clicking the flag opens Citing References, at a URL of this shape:

```
/Link/RelatedInformation/Flag?documentGuid=<the decision's GUID>&originationContext=docHeaderFlag
```

The table's columns are `Treatment | Title | Date | Type | Depth | Abridgment
Classifications`. Treatment reads as text. Depth reads through `read_page` as the label of
a `role="img"` bar, such as `Mentioned by <title>`: record that label, or `shown as image`
when none reads. Never read Depth row by row from images.

Record at most 5 rows of each list below, in this order:

1. **Narrow to decisions.** Record each content type's label and count, then apply the
   content type `Cases and Decisions`. Without it the Date sort shows mostly secondary
   sources dated only by year.
2. **Treatment counts.** On the `Filters` tab that now appears, record each `Treatment Type`
   label and count word for word.
3. **Newest first.** Set `Sort By:` to `Date`, which reloads the list newest first, and
   `20 per page`. Never rely on the default Treatment Type sort, which does not put
   negative treatment first. Record the first 5 rows' six fields word for word.
4. **The banner's label.** When a banner names a label, apply the `Treatment Type` value
   that opens with that label (`Distinguished` is `Distinguished in`), keep the Date sort,
   and record its first 5 rows the same way. With no banner, skip this.

A control that will not apply is recorded as `not recorded: <the control> would not apply`,
never as `none`, and the steps that do not depend on it still run. Applying a `Treatment Type`
value was not tried in the live run. Mark a row `Out of Plan` when it carries that badge. Open
no row: the list is the record, and a row's document is a citing decision you never read.

## 6. Export

**OPEN:** KeyCite's own export or delivery control for the Citing References list,
and its formats. Until a live run confirms one, record `Export: none`.
