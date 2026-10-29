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
Confidence: "<one line: per issue, its strength and whether its authorities were noted up, and every tier the coverage line reads NOT AUDITED>"
---
```

A double quote inside a quoted value is written `\"`.

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
- A Conclusion is one paragraph that answers the Issue as framed. It cites in parentheses and
  has no block quote. Only where research is required (`shared/legal-audit-protocol.md` Step 4),
  the last Conclusion ends with the open-issues paragraph.
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
