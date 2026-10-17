# Research memo template

This file is the single source of truth for the shape of a research memo: its header keys
and the skeletons of its three body formats. `shared/legal-audit-protocol.md` Step 6 says
who writes the memo and what each section may hold. Fill every `<...>` and leave no key out.

## Header

The memo opens with this YAML header, from its first `---` line to its second:

```
---
Document: MEMORANDUM OF LAW
Privilege: PRIVILEGED AND CONFIDENTIAL
To: <the spawn prompt's Asked by>
From: <the exact model ID your own system prompt states. If it states none, write "model ID not stated". Never a marketing name, never a guess>
Matter: "<the spawn prompt's Matter>"
Date: <the spawn prompt's Date>
Re: "<the question, one line>"
Format: <CRAC / IRAC / CREAC, the one the body uses>
Confidence: "<one line: per issue, its strength and whether its authorities were noted up, and every tier the coverage line reads NOT AUDITED>"
---
```

A double quote inside a quoted value is written `\"`.

## Body

The body opens with the question presented, then runs the format's sections in order, and
closes with the authorities relied on:

```
## Question presented

<the question, one numbered line per issue>

<the format's sections, below>

## Authorities

- <full citation>, <each pinpoint relied on>
```

**CRAC**, the default:

```
## Conclusion
## Rule
## Application
## Conclusion
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
## Conclusion
## Rule
## Explanation
## Application
## Conclusion
```

When the question splits into issues, write one sequence under each issue's own heading,
`## Issue <n>: <the issue in a few words>`, with the format's sections one level down (`###`).
`## Question presented` and `## Authorities` stay at the top level, once each.
