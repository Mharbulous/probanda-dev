---
journey: Choose the best copy (three ranked dimensions)
actor: practitioner, assisted by ingest and the affidavit-drafting skill
trigger: more than one copy of the same document is on file and one must be chosen to exhibit, list, serve, or rely on
outcome: the copy chosen is the one that ranks highest on lifecycle stage, then completeness, then quality — in that order, never averaged
preceded_by:
  - Ingest source documents into the matter
  - Drafted document lifecycle (each new version is a new copy)
followed_by:
  - Exhibit the best copy of a source document
  - Render and review the mockup (the selected copy is visible)
schema:
  - documents (one row per copy; shared label; is_best_copy; file_path; affidavit_sworn_on)
machinery:
  - ingest (recognizes an arrival as another copy of a known document)
  - affidavit assembly and service packaging (read the best copy's file_path)
  - renderer (shows which copy is selected; 🥉 when the mark is missing or stale)
work_markers: 🥉 not the best copy (admitted #305)
documents: every exhibit, every affidavit in Form 32 Part 4, every item in a VanIAC evidence index
source: issue 301 grilling, 2026-08-19 (effort owner's ruling on the ranking)
status: ratified
---

# Choose the best copy (three ranked dimensions)

"Best copy" is not one judgment. It is three, applied **in strict order**: a copy that wins on the first dimension is best no matter how it scores on the other two; the second dimension is consulted only to break a tie on the first; the third only to break a tie on the first two.

| Rank | Dimension | What it measures | Order, best first |
|---|---|---|---|
| 1 | **Lifecycle / admissibility stage** | How far the document has progressed toward being evidence the forum will accept | sworn and filed › sworn › unsworn (executed, print-ready) › draft |
| 2 | **Completeness** | Are all pages, schedules, exhibits, stamps present | complete › incomplete |
| 3 | **Quality** | Resolution, legibility, alignment, presentation | clear › poor |

## The journey, with four copies of one contract

The firm is assembling an affidavit for a VanIAC claim. The share purchase agreement is to be Exhibit A. Four copies are on file, each its own `documents` row under the label *Share Purchase Agreement*:

| Copy | How it arrived | Stage | Complete | Quality |
|---|---|---|---|---|
| **A** | Solicitor's own file — the final Word draft printed to PDF, direct from the original layout | draft (unsigned) | yes | excellent |
| **B** | Client's phone photos of the signed agreement | unsworn (executed) | yes | poor — crooked, blurry |
| **C** | Clean office scan of the signed agreement, but Schedule B was not in the bundle scanned | unsworn (executed) | **no** | excellent |
| **D** | Exhibit to an affidavit already sworn and **filed** in the related BCSC action, court-stamped; a photocopy of a photocopy | sworn and filed | yes | worst of the four |

Applying the ranking:

1. **Stage first.** D is the only copy at *sworn and filed*. D is the best copy. Its being the worst-quality scan on file does not matter; the ranking is not averaged. The affidavit attaches D.
2. Among the rest, B and C are both *unsworn (executed)*; A is *draft*, so A ranks last however clean it is.
3. **Completeness second.** B is complete and C is missing Schedule B, so B ranks above C. A crooked phone photo of the whole agreement beats a pristine scan with a schedule missing.
4. **Quality third.** It never gets consulted here — no two copies tied on the first two dimensions. It would decide only between, say, two complete executed scans of differing resolution.

Final order: **D › B › C › A.** `is_best_copy = 1` on D.

## When a better copy arrives, the mark moves

A week later the registry returns a clean, complete, court-stamped copy of the same filed affidavit. It ties D on stage and completeness and beats it on quality, so the mark moves to the new row. Any exhibit assembled after that moment attaches the new copy; any assembled before keeps what it attached. The mockup shows which row currently carries the mark so the practitioner can see the selection and catch a stale one.

## Why it is shaped this way

- Dimensions are **ranked, not weighted**, because a lawyer would never trade admissibility for resolution: a forum-stamped copy is what the court has, and that outranks everything about how it looks.
- Completeness sits above quality because a missing schedule changes what the document *says*; a blurry scan only changes how hard it is to read.
- In v1 the result of the comparison is cached as `is_best_copy`; the three dimensions themselves are not yet columns (stage is partly captured by `affidavit_sworn_on`). Whether to store the dimensions and derive the flag is a simplify-step question (#302). The journey is the requirement; the column is one way to meet it.

## What would break if this were deleted

Without a recorded choice, every assembly step re-judges four copies by eye, and the most likely error — attaching the cleanest-looking copy (A or C) instead of the filed one (D) — is exactly the one the ranking exists to prevent.
