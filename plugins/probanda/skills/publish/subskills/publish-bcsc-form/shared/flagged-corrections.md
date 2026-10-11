# Flagged corrections

This convention applies whenever a skill edits practitioner-supplied text.

## What may be corrected

**Correctable without asking:** an unambiguous misspelling or transposition in
non-operative text where the intended word admits of one reading, such as
`Corporatoin` → `Corporation`. Correct it and flag it.

**Never corrected; always raised as a question:** party names, corporate names,
numbers, dates, amounts, citations, statutory references, defined terms, and
any operative wording. A misspelled party name is substantive: it can be the
difference between naming a party and naming nobody.

The Keshmiri spelling is the worked example. It may look like a typo, but only
the corporate registry and filed record can settle it, so it is not corrected
without confirmation.

## Flag rendering

A correction made without prior approval is flagged as the struck-through
error followed by the underlined replacement, both in red. Use this KaTeX form
in chat, with `\;` for spacing or `\quad` when more separation is needed:

```text
$\textcolor{red}{\sout{\text{Corporatoin}}\;\underline{\text{Corporation}}}$
```

Use no arrow or lead-in label.

In a `.docx`, use `<w:color w:val="C00000"/>` on both runs, `<w:strike/>` on
the error, and `<w:u w:val="single"/>` on the replacement. Never allow the
chat-only `\textcolor` or `\sout` source to enter a generated document.

Underlining inside a court document is reserved for text added on amendment
under Rule 6-1 and is never decorative. A correction flag deliberately uses
the same removed/added notation because it is an annotation about the document,
not part of it. Never carry the flag into a filed version.

## Renderer record

Tested in a live Cowork session on 2026-08-09:

- Working: `\textcolor`, `\color`, `\sout`, `\underline`, nested combinations,
  fenced `diff` blocks, and emoji.
- Not working: inline HTML (`span`/`font` color markup) and GFM alert blocks.
  Inline HTML is sanitized and appears as literal tags; GFM alerts degrade to
  ordinary blockquotes with the marker text.
