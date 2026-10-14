# Westlaw AI-Assisted Research memo playbook

Two containers exist. The script handles both; this file is the format
reference.

## Primary format: non-standard OPC `.docx` (current exports)

Exports named `Westlaw Edge Canada - Westlaw AI-Assisted Research - MM-DD-YYYY (N).docx`
are ZIP packages with a **non-standard layout**: `document.xml` sits at the
package root (no `word/` folder) and the root element is `w:wordDocument`,
not `w:document`. `python-docx` fails on these
(`'lxml.etree._Element' object has no attribute 'body'`); parse
`document.xml` directly (stdlib `zipfile` + `xml.etree`).

The body is a flat sequence of one-column `w:tbl` blocks:

1. **Question block** — contains a paragraph reading exactly `Question` or
   `Follow-up question`, then a paragraph `N. <question text>` (source's own
   numbering), then answer paragraphs, terminated by the disclaimer line
   *"The above response is AI-generated and may contain errors. It should be
   verified for accuracy."* The first question block also carries a bold
   `Jurisdiction:` **or** `Jurisdictions:` line (both spellings occur) —
   memo-level jurisdiction.
2. **`Supporting materials`** — marker table, no content.
3. **Authority tables** — one table per authority: a bold `N. <name>`
   paragraph, then a bold detail line (court • jurisdiction • date •
   citations, bullet-separated), then quoted excerpt paragraphs (ignored).
   Authority numbering restarts at 1 for each question.
4. **`Additional Research on This Topic`** — marker table; more authority
   tables follow it, continuing the same numbering. These count as cited
   authorities of the question like any other.

All authority tables between question block N and question block N+1 belong
to question N. Statute names can contain a literal `|`
(`Strata Property Act | S.B.C. 1998, c. 43`) — escape pipes in Markdown
tables.

Preserve interior double spaces in question and answer text (the source uses
them after sentences; the index reproduces them verbatim).

Expected question count: 1–6 per memo. The script warns outside that range.

## Legacy fallback: pipe-delimited plain text

Older exports carry a `.docx` extension but are **plain text** pipe-tables
(`| 1\. question text |`, numbers escaped as `1\.`). The script falls back to
this parser when the file is not a ZIP. The legacy format interleaves answer
headings that mimic question numbering, so heuristic filters apply
(heading-keyword, colon, citation-density, length) — worked examples in
`filtering_examples.md`. Legacy parses extract questions only (no answer
summaries or authorities); the index marks them accordingly.

## Dating (for reference; housekeeping owns naming)

The memo's own header carries `Response generated: [Month DD, YYYY] at [time] UTC`;
convert UTC to Pacific before using as a date. `docProps/core.xml` dates are
templated and unreliable.
