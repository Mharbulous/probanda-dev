# Bookmark segmentation

Backend-free rules for splitting a bookmarked PDF into its constituent documents before extraction. Referenced (not inlined) from `../operations/ingest-extract.md` (Path E) and `../operations/extract-facts.md` §4, the way `extraction-protocol.md` is referenced today. A PDF's bookmarks (its outline) are read with `../references/scripts/extract_outline.py` — see that file's docstring for the E1+E2 exemption.

## 1. When to run

`.pdf` only, after Document pre-processing, before the affidavit detection gate. Run `extract_outline.py` on the file.

- **Script error** (`{"error": ...}`, exit 1) → report the message verbatim and fall through to the affidavit detection gate unchanged. Loud, then business as usual — never guess a segmentation from a file the script itself could not read.
- **No outline** (`entries: []`), or **exactly one entry** → fall through to the affidavit detection gate silently. A single incidental bookmark (e.g. a plain affidavit whose only bookmark is its own title) must never be mistaken for a compound book.
- Otherwise, classify every top-level entry (§2) and apply the triggers (§3, §4).

## 2. Part vocabulary

Match each top-level entry's title against these patterns, case-insensitive, tolerant of punctuation drift (`PART 1 -`, `Part 1:`, trailing spaces, mojibake from a bad apostrophe):

| Pattern | Class |
|---|---|
| `cover`, `index`, `table of contents` | ignore |
| `reasons for judgment` | reasons — report only (§3 step 3) |
| `^\s*part\s*\d+\s*[-:–]\s*order\b` (a Part heading, not a body word) | order — report only |
| `evidence`, `affidavit` | evidence — descend into children; each child is an affidavit candidate |
| `argument` | argument — report only |
| `table of authorities` | authorities list — report only (distinct from the BOA rule in §4, which applies to a standalone book of authorities, not a Part inside another book) |
| anything else | unclassified — report only |

## 3. Compound-book trigger (Path E)

Engage Path E only when **at least two distinct classes** from `{reasons, order, evidence, argument, authorities}` appear among the top-level entries. One incidental bookmark on an otherwise plain affidavit falls through to ordinary Path C on the whole file — this threshold is the compatibility guard.

When Path E engages:

1. Skip the whole-file affidavit detection gate and Paths A–D for this file; `ingest-extract.md` Path E owns it instead.
2. Each **evidence** child becomes a Path C dispatch scoped to its own `[start, end]` range (`ingest-extract.md` Path E step 2).
3. Each **reasons**, **order**, **argument**, **authorities-list**, and **unclassified** entry is reported by title and page range; nothing is written for it. For a reasons/order entry, add: "the order under appeal is reproduced in the book at pp. X–Y; ingest the entered order itself if it is not already on file."
4. An **evidence** child whose title carries no jurat cue (e.g. a bookmark named only `Exhibits`) is reported as unclassified, never guessed into Path C.
5. An entry with `page: null` (an unresolved destination) is skipped and reported, never guessed.

Ranges come from the script (`extract_outline.py`'s `range` field); the skill never recomputes them. An entry flagged `page_out_of_order` in the script's `anomalies` is still segmented using its reported range — report the anomaly alongside it, do not drop the entry.

## 4. Book of Authorities trigger

Applies instead of §3 to a standalone book of authorities (a BOA is never also an evidence book — the two triggers are mutually exclusive; if both would fire, treat it as a BOA and report the ambiguity).

Trigger: **at least two entries (any level)** whose titles contain a neutral-citation token (`YYYY court-code sequence`) or a statute token (`SBC/RSBC/SC/RSC … c N`), using the same tokenizer as `references/scripts/merge_authorities.py` ("Citation normalization" — the two MUST stay in lockstep), **and no evidence-class Part** among the top-level entries.

An entry whose title carries neither token (e.g. `Arbitration Act`, `Rule 21-8 of the Supreme Court Civil Rules, B.C.`) is still an authority candidate when it sits at the same level as tokenized siblings — it gets citation-tier lookup by title (`extraction-protocol.md` "Bundled books of authorities") and, failing a match, fresh extraction with the provision extractor.

Full write semantics — once-per-book hash tier, per-authority citation tier, fresh-extraction dispatch — live in `../shared/extraction-protocol.md`, "Bundled books of authorities."

## 5. Title decoding

Titles arrive already decoded by `extract_outline.py` (UTF-16BE, PDFDocEncoding, newline collapse). No further decoding is needed here.

## 6. Scanned exhibit letters

Applies inside Path C, whether dispatched standalone or from a Path E evidence child.

Pass 1 and Pass 2's boundary batches read the PDF through its page manifest, a scanned page only from its PNG (`../references/design-decisions.md` #71). When Pass 1 reports `scanned: true`, each exhibit letter is read again from the 150 dpi PNG of its stamp page in a letter-only dispatch, never from an OCR text layer, because a handwritten exhibit letter OCRs unreliably even when the surrounding boilerplate ("This is Exhibit ___ referred to in the affidavit of ___") reads cleanly. The main agent takes the PNG of each stamp page Pass 2 found from `pdf_pages__images` and dispatches Pass 2 once more with `STAMP_RENDERS`, which reads only those renders and returns each stamp's `letter` and `ocr_uncertain` (`../operations/ingest-extract.md` Path C, Pass 2). Pass 3 skips the stamp page and needs no render.

A letter that still does not reduce to a clean `^[A-Z]{1,2}$` token (the `AA`/`BB` doubling convention included) is returned with `ocr_uncertain: true`. It is read once more from half-page tiles of its stamp page (`tiles: true`), by `../operations/ingest-extract.md`'s Universal rules. If it is still `ocr_uncertain`, the exhibit source row then gets `notes = 'OCR: exhibit letter read as <x>; probable <y>'` and `verified = 2` — the existing §5 notes-prefix convention (`conventions.md`), no new marker family.
