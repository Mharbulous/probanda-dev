# Research memo template

This file is the single source of truth for the shape of a research memo: its header keys
and the skeletons of its three body formats. `shared/legal-audit-protocol.md` Step 6 says
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
Status: DRAFT
Confidence: "<one line: for the Issue, its strength and every tier the coverage line reads NOT AUDITED>[ <the case-level sentence>]" / "INCOMPLETE: <the research named>"
---
```

A double quote inside a quoted value is written `\"`.

Every memo is written `Status: DRAFT`. It leaves DRAFT, as `Status: FINAL`, only when every
paragraph it relies on has had its proposition-level note-up, or when the practitioner says so.
DRAFT is not INCOMPLETE: a DRAFT memo answers the Issue, and an `INCOMPLETE:` one does not.

The case-level sentence ends the `Confidence:` line whenever a case the memo relies on has
citing cases, word for word:

> The memo relies on cases that have received judicial treatment, and the treating cases have not been downloaded or reviewed to tell whether that treatment is positive, negative or irrelevant.

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

Write no legend: the save appends one, generated from the approved meaning of each symbol printed.

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
- The Rule opens with the rule itself. Each proposition of law in it is one sentence, then its
  source's own words:

  ```
  <the proposition, one sentence> (<citation>, at <pinpoint>)

  > <the verbatim passage at that pinpoint>
  ```

- The Application is prose paragraphs, never bullets. It says how each cited authority applied
  the rule, whether or not its facts resemble another's.

**A job's memo.** When the spawn prompt's `Job question:` is not `none`, the memo answers
that question and nothing else. The Issue is the spawn prompt's Job question, verbatim, never
paraphrased. No other issue or topic heading: a finding beyond the job question
goes in the notes as a Step 5 offer, never in the memo.
