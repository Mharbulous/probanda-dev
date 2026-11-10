# Shared output contract — `research_memos_index.md`

Both playbooks emit the identical structure; the script generates it. This
file is the reference for reading, reviewing, or extending the index.

## Reliability framing (non-negotiable)

AI memos are **leads, not the authority's own text**. The index encodes that
structurally:

- A top-of-file **caveat blockquote** stating every entry is unverified until
  independently checked.
- A per-authority **status**: `Unverified lead` (default) or
  `✅ Text on file` — the latter only when the authority matched a
  citation supplied via `--verified-citations` (produced by delegating to
  ``matter-data``; this skill never touches the database itself). The mark
  says only that the authority's text is on file; reliance still goes
  through `research-agent` (`shared/legal-research.md`, item 2). Citation
  matching is digit-boundary-safe (`2021 BCCRT 49` does not match
  `2021 BCCRT 496`).

## Index structure

1. **Header** — title (`# AI Research Memo Index[ -- label]`; single-source
   runs use the source's own name), Generated date, source folder, memo count
   (with per-source breakdown when mixed), question count.
2. **Caveat blockquote.**
3. **Summary index** — one table per source (`### Westlaw AI-Assisted
   Research`, `### Alexi`; a single-source run has one flat table):
   `| Memo.Q | Jurisdiction | Research question | # Cited authorities | Memo file |`
   Memo numbering is continuous across sources (Westlaw first, then Alexi);
   files sort lexicographically within a source. Questions renumber as
   `memo.question` (1.1, 1.2, 2.1 …). Pipes in text are escaped.
4. **Detail sections** — `### Memo N -- \`file\`` with jurisdiction and file
   size (KB, one decimal); Alexi memos add source/memo-type, memo date, and
   the `Regarding:` topic. Per question:
   - `**N.M. <question text>**` (interior double spaces preserved verbatim);
   - `*AI-generated summary (unverified):*` — answer paragraphs joined,
     truncated at a word boundary to ≤499 chars with ` [...]` when cut;
   - `Cited authorities (leads -- unverified):` bullet list,
     `- Name -- detail` (Westlaw detail preserves the source's bullet-separated
     court • jurisdiction • date • citations line; Alexi entries are the
     single citation line). Entries with text on file render bold with
     `-- ✅ Text on file (<citation>) -- ingested in this matter's law database, not verified.`
     Alexi additional-authorities entries carry
     `*(additional authorities section)*`.
5. **Cross-memo question dedup guard** — identical question text appearing in
   more than one memo is listed under each, cross-referenced
   `*(also asked in memo N.M)*`.
6. **Authority rollup** — `## Most frequently cited authorities across all
   memos`: `| Times cited | Authority | Detail | Status |`, ranked by number
   of citing question-answers, cut off below 5 citations with an explicit
   omitted-count note (including the total distinct-authority count).
   Distinct decisions sharing a style of cause (a BCSC decision and its
   appeal) are separate rows — keyed by name + detail, not name alone.
7. **Files not indexed** — present only when non-empty: every skipped or
   errored file, by name, with the reason. Nothing is dropped silently.

## Guardrails

- The rollup is a **verification work-queue**, not a bulk-ingest trigger —
  ingestion stays with ``ingest``, per authority.
- Memo answer text never enters the case database; leads live in this file
  only.

## Regression baseline

L8145 (`6. LAW\AI memos (Westlaw)`): 22 memos / 48 questions / 491 distinct
authorities by name (497 by name+detail). Material drift on a re-run means a
parser regression. (The pre-refactor 2026-07 baseline index had two known
defects, deliberately not reproduced: six authorities counted in its summary
were missing from its detail lists, and same-name different-court decisions
were conflated in its rollup.)
