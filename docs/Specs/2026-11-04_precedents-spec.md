# Precedents

Status: create, modify and organize are built (`.claude/skills/precedents/`). The rest of this design is not. Decided by the practitioner in an interview on 2026-11-04.

## What the problem was

Asked to turn a finished letter into a reusable precedent, a session found nothing in Probanda and improvised. Regenerating the document lost the practitioner's manual layout edits, kept a Re-line pattern the practitioner had removed and missed the header file-number field. "Keep the layout" (`.claude/skills/draft/references/unstructured.md` section 5) saves a drafting layout rather than a Word file, and cannot take a client letter (`letters.md` section 10).

## The 12 decisions

| # | Decision | State |
|---|---|---|
| 1 | A precedent is one Word master with placeholders and alternative clauses. Signed PDFs only record where the wording came from. | Master built. Alternative clauses not built |
| 2 | Fixed wording is copied word for word. Details come from records or the practitioner, the practitioner makes the choices, and `lawyer:scrivener` writes new sentences, which get the source trace. | Not built (filling) |
| 3 | Probanda proposes the marked-up precedent and flags judgment calls, and the precedent goes live only on approval. | Built |
| 4 | When a document goes out, Probanda compares its fixed wording with its precedent version and asks only about changes. A filled blank or a choice among alternative clauses never triggers this. A roster lawyer approves any precedent change. | Not built |
| 5 | Versioning follows the file name: a date or a version number means side-by-side files. | Built, as amended below |
| 6 | Retainer agreements come first, on a design later types can reuse. | The build is not specific to any type |
| 7 | There are three stages. **Unstructured**: every blank is a highlighted field a model fills. **Hybrid**: some blanks have a set source and at least one is still a highlighted field. **Structured**: every blank has a set source: data, the practitioner's choice, or a sentence typed or requested from the scrivener. | Not built |
| 8 | Probanda introduces structured precedents when the practitioner's words call for them, and offers once at a precedent's third use. The message says an unstructured precedent is quick to set up but slightly more error-prone and costs tokens each use, while a structured one takes time and tokens to set up but is then faster, more consistent and cheaper. By the practitioner's estimate it breaks even after 5 documents. It names no programming language. | Not built |
| 9 | Each precedent lists the provisions its fixed wording relies on. An amendment stops the next fill until a lawyer re-approves it. | Not built |
| 10 | The rule against stating law is triggered only when inference creates or modifies a statement about the law. Copying verbatim does not trigger it. A statement copied from anything other than a primary authority counts as new, though fixed wording of an approved precedent, and a standing client-guidance paragraph, stay exempt. Code is outside the rule and never writes legal sentences. | Built for creating and changing a precedent: statements of law are flagged, and changes go through the scrivener |
| 11 | Probanda offers to create a precedent when asked, or when the practitioner seems to expect one to exist. | Built |
| 12 | The hybrid suggestion is one closing line needing no reply, shown only when something new can convert. | Not built |

**Amending decision 5 (2026-11-04):** never overwrite, for any naming style. The interview allowed a description-only name to overwrite, and the practitioner withdrew that when ruling on this build. A name that exists takes ` (2)`.

The practitioner's pattern is `{YYYY-MM-DD} {description} - PRECEDENT`.

## Design choices made while building

- **Precedent settings are not a folder map entry.** Entries are matter-relative globs and a precedents folder is firm-level, so `folder-maps/<person>.json` holds a sibling `precedents: {folder, name_pattern}`. The folder is relative to the folder holding `0. CASE DATA`, so each device resolves the same setting.
- **Modify is Create run on the edited copy.** There is one code path. Highlighted placeholders pass through.
- **The leftover check is wider than the replacing.** Replacing is exact in case and whole-word, so "Al" never rewrites "also". The check ignores case, looks inside longer words, and reads every XML part and the output name, so a file code `DoeP` is caught by the value `Doe`. A false refusal costs one more replacement, and a missed client detail in a firm-wide file costs far more.
- **Known limit.** The check reads no image or other binary part, such as a thumbnail or a picture of text.

## Not built

- Filling a precedent for a client, keeping the master's own letterhead, needing a destination folder but no matter record, and held until a lawyer approves as `letters.md` section 10 holds a client letter. A copy with an unfilled placeholder cannot go out.
- Comparing a sent document with its precedent version (decision 4). This needs a private copy of each approved version, since an edited master could otherwise lose the old wording.
- Marking a precedent stale after an amendment (decision 9).
- Alternative clauses, and hybrid and structured precedents (decisions 1, 7, 8 and 12). A litigation date in a structured precedent still comes from the docket clerk.
- Renaming the practitioner's two existing precedents, whose names hold a client code. Organize flags them.
