# Style of proceeding

Read this guide only after a non-Form-62 court form has been classified and
only when that form uses a style of proceeding.

The confirmed proceedings profile is the source of truth for the court file
number, registry, party names, and role labels. Do not infer those values from
the form request. Applying the prescribed caption casing is formatting, not a
change to the profile. The `.dotx` template remains the source of truth for
typography, alignment, and spacing.

Never underline for emphasis; underlining marks added text in amended documents only.
When an election is confirmed, remove unelected branches; never leave empty choice boxes.
Keep prescribed appendices distinct and complete; preserve their page breaks and choices.
Clear page-one top-left; centre its one-time header; keep signature blocks whole with signing room.
Before delivery, render and compare every page with its template or supplied exemplar.
Use only prescribed fields; do not duplicate address parts; retain template date/time formats.
Never select or assert an election without record support or practitioner confirmation.
Correct only obvious non-operative typos under
[`subskills/publish-bcsc-form/shared/flagged-corrections.md`](../../shared/flagged-corrections.md); raise
substantive uncertainty for direction.

## Order and structure

Render the caption in this order:

1. `No. {court file number} {registry} Registry`
2. `In the Supreme Court of British Columbia`
3. `Between`
4. The originating party name or names
5. The originating role label
6. `and`
7. The responding party name or names
8. The responding role label

Keep party names and role labels in the distinct template paragraphs supplied
for them. When the confirmed profile contains another role group, append an
`and` paragraph, its party-name paragraph, and its role-label paragraph in the
profile's order. Do not collapse distinct role groups into one caption block.

Within a single role group, run the parties together as a prose list in one
paragraph -- one paragraph per group, never one per party. Comma-separate the
names and prefix the last with a serial comma and a lower-case `and`. The
serial comma applies at every count, including two:

| Parties in the group | Rendered |
| --- | --- |
| one | `ALICE EXAMPLE` |
| two | `ALICE EXAMPLE, and ALEX EXAMPLE` |
| three | `BETA COMPANY LTD., CHARLIE EXAMPLE, and DELTA HOLDINGS INC.` |

The separator `and` is lower case and is always a literal, never derived from
a party name. A party whose own name contains `AND` keeps it upper case:
`SMITH AND SONS LTD., and BETA LTD.` Nothing may re-case the joined result,
because party names are upper-cased individually before they are joined.

Indent the names paragraph equally on both sides so a long list wraps in a
narrower measure. The indents must be equal, or centring shifts the block off
the page centre. This is a deliberate departure from the prescribed forms,
which set one party per line; it was chosen by the practitioner on
2026-09-21 and is recorded in issue #770.

A counterclaim does not create new caption entries for existing parties. Under
Rule 3-4(3), the plaintiff remains `Plaintiff`, every defendant remains
`Defendant`, and only a person not already a party is added, as `Defendant by
way of counterclaim`. Do not append a role group that re-names a party already
captioned above.

The form title and party names are capitalized. The court name, `Between`,
`and`, and role labels use the sentence case shown above. `Between` and `and`
never take colons.

Where a party-name line contains `and`, determine whether it joins two parties
or falls inside one party's name:

1. If the confirmed proceedings profile holds the parties as separate records,
   the `and` between them is a conjunction — lowercase.
2. Otherwise search the matter's `4. LAWYER BRIEF\CORPORATE\` folder for a
   company summary (`SMRY` in the filename) and read the `Name of Company`
   field. A registered name containing `AND` takes the party-name
   capitalization. The filename is not evidence.
3. Failing both, use the name exactly as it appears in the most recently filed
   pleading or order and flag the uncertainty under
   [`subskills/publish-bcsc-form/shared/flagged-corrections.md`](../../shared/flagged-corrections.md). Never
   infer.

For example, one registered company followed by two individual parties renders
as `DR. S. LINDQVIST AND DR. L. ABERNETHY INC., SAMUEL LINDQVIST and LAURA
ABERNETHY`.

## Physical handling

The form-number header is optional. Where a form carries one, it appears on the
first page only — `titlePg` in `sectPr`, with an empty default header — and is
centred. The top-left corner of page 1 is reserved for the registry clerk's
filing stamp and carries no content.

A signature rule is drawn as the bottom border of a table cell, never as an
underlined run or a bottom-bordered paragraph — a paragraph rule collapses to
the height of its own text and leaves nowhere to sign. The signing row carries
an explicit `trHeight` of at least 800 twips with `hRule="atLeast"`.

Every row of a signature block carries `cantSplit`. A signature separated by a
page break from the rule and the name it authenticates is ambiguous on its
face. This complements the Form 15 rule reserving the jurat for the
commissioner's stamp.

## Example

```text
No. S-290004 Vancouver Registry
In the Supreme Court of British Columbia
Between
GLEN ASHBY
Plaintiff
and
WAYPOINT VENTURES INC. and HARBOUR CREST INVESTMENTS INC.
Defendants
```

Repository enforcement: `subskills/publish-bcsc-form/scripts/fill_plain.py` supplies the common caption
fields and inserts additional confirmed caption groups.
