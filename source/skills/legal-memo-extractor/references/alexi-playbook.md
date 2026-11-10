# Alexi memo playbook (Instant Memo / Pro Memo)

Verified against real exports 2023-12 → 2025-03 across 7+ matters
(format-discovery record: `Engineering/2. Plan/2026-07-19 Alexi format findings.md`).

## Containers

- Memos export as **.docx + .pdf pairs** (email exports) or PDF-only (files
  moved into `6. LAW`). When a `.docx` sibling of the same stem exists, the
  script parses it and skips the PDF (better fidelity).
- `.docx` is a *standard* OPC Word package — unlike Westlaw's layout.
- `.pdf` is wkhtmltopdf 0.12.6 output (PDF 1.4, `/Title (Alexi)`), stable
  across every vintage. Fonts are Identity-H subsets **with ToUnicode CMaps**,
  so the script extracts text with stdlib zlib + CMap mapping — no pypdf. If
  a PDF defeats extraction, it is reported by name, never silently dropped.
- `docProps/core.xml` dates are empty — never date from file metadata.

## Structure (.docx: named paragraph styles; normalize by stripping `_` + lowercasing)

| Normalized style | Role |
|---|---|
| `headerstyle` | `Memo To:` / `File:` / `Research ID:` / `Jurisdiction:` (2025+: `Province/Territory:`) / `Date:` / `Regarding:` |
| `badgestyle` | `Instant Memo` or `Pro Memo` |
| `headingstyle` | Section headings (see vocabularies below) |
| `paragraphstyle` / `blockquotestyle` | Body / quoted passages |
| `authoritiesstyle` | One authority per paragraph: `<case name>, <neutral citation> (CanLII)` |

Some instant memos open with a bold unstyled **AI Disclaimer** paragraph
before the header block.

## Section heading vocabularies (evolved; the script maps aliases)

| Vintage | Headings |
|---|---|
| Pro 2023-12 | Issue, Research Description, Conclusion, Law, Authorities |
| Instant 2024-02 | Issue, Research Description, Executive Summary, Conclusion, Law, Authorities |
| Instant 2024-03 → 2024-09 | Issue, Research Description, Answer, Legal Principles, Discussion of Law, Cited Authorities, Additional Authorities |
| Instant 2025-03+ | Question, Facts, Answer, Legislation, Case Summaries, Cited Authorities, Additional Authorities |

Mapping rules:
- **Question** = first `Issue` or `Question` section — exactly one research
  question per memo. **2025+ trap:** `Case Summaries` contains per-case
  sub-headings that reuse `Facts`/`Issue`/`Legal Principles`/`Application`/
  `Conclusion` — only the *first* Issue/Question section is the memo's
  question.
- **Answer summary** = first of `Answer` / `Executive Summary` / `Conclusion`
  appearing after the question.
- **Authorities** = every section whose heading contains "Authorities";
  entries under `Additional Authorities` are flagged as additional.

## PDF rendering quirks (handled by the script)

- Headings render at the same font size as body text — match by exact text.
- Header values wrap; 2025+ renders the label and `: value` on separate lines.
- Running footer `Alexi | Page` + page number interleaves with body text.
- Authority entries wrap across lines; an entry ends with a parenthesized
  citation token — `(CanLII)`, `(ON SC)`, `(NS CA)`, … Statutes (e.g.
  `Arbitration Act`) have no such token and stand alone.
- The PDF prefixes `Research ID:` values with `#` — stripped for dedup.

## Metadata

- **Date** = the `Date:` header line, `Month D, YYYY` (occasional double
  spaces). It is Alexi's memo date — use as-is, no timezone conversion.
  Verified exact against email-export folder dates on 5 samples.
- **Topic** = the `Regarding:` line — ready-made for housekeeping's
  `YYYY-MM-DD Alexi [topic].pdf`; fall back to compressing the question.
- `Jurisdiction:` (2025+: `Province/Territory:`), `Research ID:` (matches the
  filename suffix).

## Duplicates and exclusions

- Export filenames: `Alexi_instant_memo_<First_three_words>_<research-id>` /
  `Alexi_pro_memo_…`. Email-export duplicates append ` - N`; same Research ID
  ⇒ same memo. The script keeps the best copy per Research ID
  (**Pro Memo beats Instant Memo, .docx beats .pdf**) and lists the rest
  under "Files not indexed".
- **Not research memos** (skip): `Alexi_WeeklyReport_*` /
  `* Alexi Weekly (Activity) Report.pdf` (accounting),
  `Alexi_Accounting_*.csv`. "Alexi" in a filename alone is not sufficient.

Expected question count: exactly 1 per memo; the script warns otherwise.
