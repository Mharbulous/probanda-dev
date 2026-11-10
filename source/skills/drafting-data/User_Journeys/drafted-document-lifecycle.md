---
journey: Drafted document lifecycle (draft to filed)
actor: practitioner, the deponent, the commissioner, the registry
trigger: the firm begins drafting a document it will itself execute and file (an affidavit is the model case)
outcome: the copy the firm treats as current is always the furthest-progressed version; the filed, court-stamped copy is the final best copy
preceded_by:
  - Exhibit the best copy of a source document (exhibits are attached partway through this lifecycle)
followed_by:
  - Render and review the mockup
  - Serve and file
schema:
  - documents (one row per version; affidavit_sworn_on; is_best_copy — or a stage, see below)
  - filing_documents (Form 32 Part 4 "Affidavit #n of X made date")
machinery:
  - affidavit-drafting / assembly (Word draft → print-ready PDF → exhibits attached → exhibit stamps)
  - renderer: ✒️ swear it reads affidavit_sworn_on
work_markers: ✒️ swear it (formerly 🗒️ awaiting signature — struck 2026-08-19, work-markers.md table 6)
documents: every affidavit in Form 32 Part 4; any firm-authored document that is executed and filed
source: issue 301 grilling, 2026-08-19 (effort owner's description)
status: verified (#305, 2026-08-19; the stage-column add-back question stands)
---

# Drafted document lifecycle (draft to filed)

## The journey

The same document passes through versions that differ not in scan quality but in **authority and reliability** — how far along it is. Each version supersedes the last as the best copy, and each is a real file the firm keeps. For an affidavit:

1. **Markdown mockup projection.** Before any Word file exists, `/draft`'s deterministic engine renders a markdown projection of the document straight from what's already stored in the submission database. Not an authored file — regenerated fresh on demand.
2. **Word draft.** Unsigned, wording not yet vetted, no jurat. Until anything else exists (besides the mockup projection). Better than mockup projection.
3. **Print-ready PDF.** After the deponent's wording changes, printed to PDF (or paper). Ready to sign, not signed; may still need changes. Better than the draft.
4. **Exhibits attached.** The exhibits are appended (each the best copy of its source document at that time — see `exhibit-the-best-copy.md`). Better again.
5. **Exhibit stamps applied.** Now the best copy.
6. **Sworn and witnessed.** The deponent signs, the commissioner witnesses; the firm scans it. The commissioner may have forgotten their stamp.
7. **Commissioner's stamp applied.** Re-scanned. Best copy.
8. **Filed.** Comes back from the registry with the court stamp. The final best copy.

At every step the firm wants to know, without opening files, which version is current, and the mockup's ✒️ swear-it marker clears at step 6.

This lifecycle is the **first and most important of the three dimensions of "best"** (sworn and filed › sworn › unsworn › draft), ahead of completeness and quality. The ranking and a worked example live in `choose-the-best-copy.md`.

## Why the data is shaped this way — and an open question

- Versions are separate rows in `documents` because each is a distinct file that may be needed later (the unsworn PDF is what the deponent reviewed; the filed copy is what the court has).
- The owner's #300 requirement was "the database remembers which copy is the one to file". For this journey that copy is always the furthest-progressed version, so **"best" is derivable from a stage** — and a stage carries more than the boolean does (it is what ✒️ and any "filed?" marker would read). #300 struck `documents.legal_status` as having no reader; this journey is a candidate reader, and the delete step's ledger records it as the add-back signal for a stage column rather than deciding it here.
- `affidavit_sworn_on` already records step 5; the other steps have no column in v1.

## What would break if this were deleted

Without a best-copy mark (or stage), an agent assembling Form 32 Part 4 or a service package cannot tell the sworn-and-stamped scan from the unsigned print-ready PDF except by filename, and the practitioner has no surface showing which version the plugin considers current.
