# Research memo template

This file is the single source of truth for the shape of a research memo: its header keys,
its three body formats and its numbered items. `shared/legal-audit-protocol.md` Step 6 says
who writes the memo and what each section may hold. Fill every `<...>` and leave no key out.

## Header

The memo opens with this YAML header, from its first `---` line to its second:

```
---
Date: <the spawn prompt's Date>
Document: MEMORANDUM OF LAW <the spawn prompt's Job, a bare number. Nothing after LAW when it reads none>
Status: <one value under "Status" below>
Re: "<the question, one line>"
---
```

A double quote inside a quoted value is written `\"`. The header holds these keys and no other. Every render prints it in this form, so a memo saved in an older form re-renders in this one.

A memo is INCOMPLETE when it holds the open-issues paragraph (`shared/legal-audit-protocol.md` Step 4). A memo saved before 2026-11-03 is also INCOMPLETE when a header value starts `INCOMPLETE`.

### Status

D is the spawn prompt's Date. A memo whose `Last status:` is `none` or a DRAFT is
`DRAFT (last updated D)` until approved, then `FINAL (approved D)`. Any other is
`REVISING (last revised D)` until approved, then `UPDATED (updates approved D)`. The memo is approved
only when the spawn prompt's `Approve:` reads `yes` and one route below is met; otherwise the return
says which route is unmet. Nothing else ends DRAFT or REVISING. DRAFT is not INCOMPLETE: a DRAFT memo
answers the Issue, and an `INCOMPLETE:` one does not. A FINAL or UPDATED memo is saved again only
under its reopened job, and its saved copy stays as the approved version.

1. Every proposition of law the memo cites, and every case cited in Application
   for a finding of fact or of law, has a proposition-level note-up.
2. Each of them has a case-level note-up, and every citing decision its record lists that treats
   the case negatively or that no citator classifies has been read at its pinpoint against the
   proposition or finding the case is cited for.

While any relied-on case with citing cases has only a case-level note-up, the return's `Audit:`
line (`shared/legal-audit-protocol.md` Step 6) ends with this sentence, word for word:

> The memo relies on cases that have received judicial treatment, and the treating cases have not been downloaded or reviewed to tell whether that treatment is positive, negative or irrelevant.

### Check labels

A memo's notes report each case's two checks apart, in these labels and no others.
`shared/legal-audit-protocol.md` Step 2 says how each check is done.

- `history: checked`: every later decision in the case's own proceeding that reviews it
  (judicial review, appeal, SCC leave) was read against every paragraph citing the case. A case
  whose history check is not complete makes the memo `INCOMPLETE:`.
- `case-level`: a citator's flag and count of citing decisions in other proceedings, not all
  of them read for the proposition.
- `proposition-level: ¶4, ¶5`: at most 5 citing decisions per authority, chosen by
  `shared/legal-research.md`, "Proposition-level note-up", were read at the pages that cite it
  against the named paragraphs' proposition or finding.
- `NOT NOTED UP`: no note-up.

`noted up` is never a label: a citator list alone shows no treatment.

## Body

The body runs the format's sections in order and closes with the sources relied on:

```
<the format's sections, below>

## Sources

### Statutes
### Case authority
### Secondary sources
```

Each source is one bullet, `<full citation>, <each pinpoint relied on>`. Statutes also holds
regulations and rules. Omit a subsection with no entries. Sources are listed here and
nowhere else. Define an abbreviation in parentheses where the body first uses it.

Write no legend and no work marker: the saved copy prints each marker from the stored rows
(📇 on an authority not yet noted up) and ends with a legend generated from the approved meaning
of each symbol printed.

**ICRA**, the default:

```
## Issue
## Conclusion
## Rule
## Application
```

**IRAC**, only when the spawn prompt's `Memo template:` names it:

```
## Issue
## Rule
## Application
## Conclusion
```

**CREAC**, only when the spawn prompt's `Memo template:` names it:

```
## Issue
## Conclusion
## Rule
## Explanation
## Application
## Conclusion
```

The Issue, each Conclusion and the Sources are prose. Every other section is a list of
numbered items, numbered from 1 through the whole memo and never restarted at a heading, so
a paragraph number names one item. Each item holds one proposition or finding, from one excerpt
of one authority, in exactly this shape:

```
<n>. <one sentence: what the excerpt says>
   Authority: <style of cause or title>
   Citation: <citation>
   Kind: <case / statute / regulation / rule / doctrine>, <primary / secondary>
   Pinpoint: <the pinpoint>
   > <the verbatim passage at that pinpoint>
```

The pinpoint and passage follow `shared/legal-audit-protocol.md`, "Excerpts". A point two authorities support is two items. Each item supports a sentence of a Conclusion:
an item that supports none is out of scope (`shared/legal-audit-protocol.md` Step 4).

In every format:

- The Issue is the question: any context sentences, then the one question, the whole paragraph
  in bold. One memo has one `## Issue` and no sub-issues. The Issue:
  - **A.** holds one question;
  - **B.** makes sense on its own;
  - **C.** holds at most one list, and that list conjunctive, joined by "and". "Is gambling legal
    in BC and Alberta?" meets it. "Is gambling legal in BC or Alberta?" lists alternatives, so it is
    two questions and two memos, and "Is prostitution and gambling legal in BC and Alberta?"
    crosses two lists;
  - **D.** names nothing that identifies the client, the parties, the people involved or the
    proceeding. Context may hint at the setting ("a commercial tenant"), never identify it.

  **A job's memo.** In an audit whose `Job question:` is not `none`, the Issue is that question
  verbatim if it meets rules A to D. If not, return no memo but one rewording proposal
  (`shared/legal-research.md`, "A research question holds one question").
- A Conclusion is one paragraph answering the Issue, followed, only where research is required
  (`shared/legal-audit-protocol.md` Step 4), by the open-issues paragraph, after the last
  Conclusion. It cites in parentheses and has no block quote.
- The Rule opens with the rule itself: its first item states it.
- The Application: one sub-section per case, its items together. Each item is one finding of
  that court, its sentence opening `fact:` or `law-applied:` (the law applied to the facts to
  reach a holding), from the court's own reasons (`shared/legal-audit-protocol.md` Step 2).
  Each case has at least one `fact:` item and at least one `law-applied:` item, the facts being
  those that court applied the law to.
