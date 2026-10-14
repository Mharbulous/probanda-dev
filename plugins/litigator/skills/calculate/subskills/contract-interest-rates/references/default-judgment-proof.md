# Proving the inputs on a default judgment

A calculation is only as good as the evidentiary standing of the numbers going
into it. On an ordinary contested application that standing is somebody else's
problem -- the affidavit material is already being assembled around it. On an
application for **default judgment** it is this skill's problem, because the
whole point of the application is that nothing will be proved at a hearing.

This reference exists because a calculation was once built for a default
judgment by continuing from a prior internal firm memo's closing balance, over
a rate history taken from the memo and the open web. Every figure was arguably
correct. None of it was evidence.

## The rule the practitioner works to

Judgment by default proves the facts **pleaded in the Notice of Civil Claim**,
and nothing else. So a calculation can be relied on without further proof only
where it derives from pleaded facts as **pure arithmetic**. Any input the
pleading does not state has to be proved by affidavit, or else assessed at a
hearing on damages.

Three consequences worth stating plainly, because each one has been missed:

- **An internal memo proves nothing.** A prior firm calculation, a file note,
  a spreadsheet someone built last year -- these are postulates, not claimed
  facts and not evidence. Never take an opening balance from one.
- **The contract is not self-proving.** Reading the rate clause out of the
  executed agreement is the right way to classify the rate (see
  `fixed-vs-floating.md`), but on a default judgment the clause is only
  *admitted* so far as the pleading pleads it. Where the contract and the
  pleading diverge, say so rather than silently preferring either.
- **A benchmark rate history is a fact like any other.** A pleading normally
  pleads prime on one date, not the eight or ten changes a floating
  calculation runs through. The rest needs an affidavit -- typically an
  affidavit exhibiting the bank's published prime rate history.

Whether a *particular* input is admitted on a default judgment is a question
of law, not arithmetic. Where it is genuinely in doubt, route it to
``legal-research`` rather than deciding it here.

## Classify every input before calculating

For each figure the calculation consumes -- principal, credits, accrual start
and end dates, the spread, each benchmark rate and its effective date -- record
one of:

| Standing | Means | Carry |
|---|---|---|
| `pleaded` | stated in the Notice of Civil Claim | the paragraph number **and the words** |
| `sworn` | in an affidavit already filed or to be filed | the affidavit and paragraph |
| `needs proof` | neither | what affidavit would carry it |

Then report the `needs proof` list to the practitioner **before** handing over
a total. That list is the deliverable, not a footnote: it is what tells the
practitioner whether the judgment can be taken out at the registry or whether
an affidavit has to be sworn first.

## What the calculation artifact has to show

A default-judgment interest calculation is read by a registrar who has only the
filed material. It has to be checkable line by line, on its face, without
leaving the page:

- **A row per sub-period** -- dates, rate, days, the arithmetic, the running
  balance. A prose paragraph asserting a total is not a calculation.
- **Excerpts, with pinpoint citations, of the pleaded passages the inputs come
  from.** Set out the words of the paragraph beside the figure it establishes,
  not merely a reference to it. A bare "para. 11" attribution makes the reader
  go and find the pleading; the excerpt lets them confirm the arithmetic runs
  on admitted facts where they are.
- **Inputs grouped by standing**, so pleaded figures, figures resting on
  affidavit evidence, and pure arithmetic are visibly separate rather than
  interleaved in one undifferentiated table.
- **Every source cited**, per the main skill's step 5.

Where a spreadsheet is the natural form for that, produce one. A calculation
built by a throwaway script that is then discarded leaves nothing anybody can
re-run or check, and the script was the only thing that knew the method.
