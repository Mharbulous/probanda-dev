# Research memo template

This file is the single source of truth for the shape of a research memo: its header keys,
its three body formats and its numbered items. `shared/legal-audit-protocol.md` Step 6 says
who writes the memo and what each section may hold. Fill every `<...>` and leave no key out.

## Header

The memo opens with this YAML header, from its first `---` line to its second:

```
---
Document: MEMORANDUM OF LAW
From: <the exact model ID your own system prompt states. If it states none, write "model ID not stated". Never a marketing name, never a guess>
Date: <the spawn prompt's Date>
Re: "<the question, one line>"
Format: <ICRA / IRAC / CREAC, the one the body uses>
Status: DRAFT / FINAL
Confidence: "<one line: for the Issue, its strength and every tier the coverage line reads NOT AUDITED>[ <the case-level sentence>]" / "INCOMPLETE: <the research named>"
---
```

A double quote inside a quoted value is written `\"`.

### Status

A memo is `Status: DRAFT` until one route below is met, and then `Status: FINAL`. Nothing else
ends DRAFT. DRAFT is not INCOMPLETE: a DRAFT memo answers the Issue, and an `INCOMPLETE:` one does
not.

1. **Automatic.** Every proposition of law the memo cites, and every case cited in Application
   for a finding of fact or of law, has a proposition-level note-up.
2. **On instruction.** Each of them has a case-level note-up, every citing decision that treats
   the case negatively or that no citator classifies has been read at its pinpoint against the
   proposition or finding the case is cited for, and the spawn prompt's `Final instructed:` reads
   `yes`.

While any relied-on case with citing cases has only a case-level note-up, the `Confidence:`
line ends with this sentence, word for word:

> The memo relies on cases that have received judicial treatment, and the treating cases have not been downloaded or reviewed to tell whether that treatment is positive, negative or irrelevant.

### Check labels

A memo's notes report each case's two checks apart, in these labels and no others.
`shared/legal-audit-protocol.md` Step 2 says how each check is done.

- `history: checked`: every later decision in the case's own proceeding that reviews it
  (judicial review, appeal, SCC leave) was read against every paragraph citing the case. A case
  whose history check is not complete makes the memo `INCOMPLETE:`.
- `case-level`: a citator's flag and count of citing decisions in other proceedings, not all
  of them read for the proposition.
- `proposition-level: ¶4, ¶5`: every citing decision was read at its pinpoint against the named
  paragraphs' proposition or finding.
- `NOT NOTED UP`: no note-up record.

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

A point two authorities support is two items.

In every format:

- The Issue is the question, as one bold sentence. One memo has one `## Issue` and no
  sub-issues. The Issue:
  - **A.** holds one question;
  - **B.** makes sense on its own;
  - **C.** lists alternatives in one place at most. "Is gambling legal in BC or Alberta?" is one
    question, but "Is prostitution or gambling legal in BC or Alberta?" crosses two lists into
    four questions, and so four memos.
- A Conclusion is one paragraph answering the Issue, followed, only where research is required
  (`shared/legal-audit-protocol.md` Step 4), by the open-issues paragraph, after the last
  Conclusion. It cites in parentheses and has no block quote.
- The Rule opens with the rule itself: its first item states it.
- The Application: its items say how each cited authority applied the rule, whether or not its
  facts resemble another's.

**A job's memo.** When the spawn prompt's `Job question:` is not `none`, the memo answers
that question and nothing else. The Issue is the spawn prompt's Job question, verbatim, never
paraphrased. No other issue or topic heading: a finding beyond the job question
goes in the notes as a Step 5 offer, never in the memo.
