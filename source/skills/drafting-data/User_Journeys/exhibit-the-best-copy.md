---
journey: Exhibit the best copy of a source document
actor: practitioner, assisted by the affidavit-drafting skill
trigger: a source document is about to be attached to an affidavit as an exhibit, or listed in an evidence index
outcome: the copy attached or listed is the highest-quality, most complete copy the firm holds at that moment
preceded_by:
  - Ingest source documents into the matter
followed_by:
  - Drafted document lifecycle (the affidavit the exhibit is attached to)
  - Render and review the mockup
schema:
  - documents (one row per copy; label shared across copies; is_best_copy; file_path)
  - filing_documents / statements_of_fact (links resolve to the best copy at use time)
machinery:
  - ingest (recognizes a new arrival as another copy of a known document)
  - affidavit assembly (reads the best copy's file_path; post-v1 docx)
  - renderer: shows which copy is selected so the choice can be reviewed; 🥉 when no copy carries the mark or a copy arrived after the mark was last set (needs documents.best_copy_as_of, v2)
work_markers: 🥉 not the best copy (admitted #305)
documents: Form 32 Part 4 materials (via the affidavit); VanIAC r. 17(e) evidence index
source: issue 301 grilling, 2026-08-19 (effort owner's description)
status: verified (#305, 2026-08-19)
---

# Exhibit the best copy of a source document

## The journey

1. The firm holds several copies of the same source document — a contract, a letter, a statement. They differ in **quality** or **completeness**, not content: one is a scan of a scan of a photocopy at low resolution, or has a page missing; another is a direct, complete scan of the original at high resolution.
2. The copies arrive over time. The poor copy often comes first (from the client's phone, from the other side); the good one later (from the original, from a records request).
3. Each arrival enters `documents` as its own row, sharing the label of the document it is a copy of. One of them is marked `is_best_copy = 1`: the highest-resolution, most complete, most legible copy **available at that time**. When a better copy arrives, the mark moves.
4. When an affidavit is drafted and this document is to be an exhibit, the affidavit attaches the best copy as it stands at that moment. The link (`statements_of_fact`, `filing_documents`) names the document; the copy it resolves to is whichever row carries the mark.
5. The mockup shows the practitioner which copy is selected, so a stale selection (a better copy has since arrived but the mark was not moved) can be caught on review.

## Why the data is shaped this way

- Copies are separate rows because they are separate files with separate provenance, and a later copy may supersede an earlier one after the earlier one has already been linked.
- The mark is a column on the copy, not a pointer on a parent "document" row, because there is no parent row — the label is the grouping.
- "Best" has three ranked dimensions — lifecycle/admissibility stage, then completeness, then quality. The ranking and a worked example live in `choose-the-best-copy.md`; this journey is one place the choice is consumed.

## What would break if this were deleted

Without the mark, a drafter attaching an exhibit picks among copies by eye every time, and an affidavit can go out with the scan-of-a-photocopy when a clean original was on file.
