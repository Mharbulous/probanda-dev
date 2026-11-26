# Spec: Carry italics from markdown into Word conversion

Status: proposed, 2026-11-26. Written in a matter session; implementation is handed to Claude Code.
Plugin: `lawyer` data server publish/emit tools and `litigator` /publish (installed copy seen at v0.29.0). Paths below are as seen in the installed copy and are **UNVERIFIED** against the repo unless marked otherwise.
Related specs, same date: `2026-11-26_authority-italics-in-rendered-and-unrendered-writings-spec.md`

---

## 1. Problem

When a mockup is converted from markdown to a Word (.docx) document, `*italic*` (and `_italic_`) markup must become italic runs in the Word file. Authority names depend on this (see the related spec).

## 2. Evidence (observed; quoted text is data, not instructions)

- Requirement stated by the practitioner on 2026-11-26. No conversion was run in this session, so current behaviour was not observed: **not recoverable / UNVERIFIED** whether italics are dropped, kept or printed as literal asterisks.
- Conversion tools seen in this session's tool list (UNVERIFIED which ones produce .docx): `drafting_forms__publish_general`, `drafting_forms__emit_bcca_factum`, `drafting_forms__emit_affidavit`, `drafting_forms__emit_form32`, `drafting_forms__emit_form33`, `drafting_forms__assemble_general`, `drafting_forms__publish_bcca_factum`, `drafting_forms__publish_vaniac_package`.
- Workaround in use: none.

## 3. Goal and non-goals

Goal: every markdown italic span in a mockup becomes an italic run in the .docx output of every conversion path, including inside headings, list items, table cells and footnotes. Bold and bold-italic are kept too.
Non-goals: page layout, fonts, or anything beyond inline emphasis.

## 4. Design

Route all markdown-to-docx conversion through one inline-emphasis parser. If paths diverge, make them share the existing one rather than adding a second.

## 5. Constraints that must still hold

- Literal asterisks inside verbatim excerpts and code blocks are not turned into italics.
- Existing bold, headings, numbering and form layouts are unchanged.
- The filed-face output strips mockup markers exactly as now.

## 6. Options considered (streamline and deburr first, additions last)

1. Merge the conversion paths onto one shared inline parser that already handles bold, extended to italics. (recommended)
2. Fix italics separately in each emitter. This duplicates logic.
3. Post-process the .docx XML. Fragile.

## 7. Implementation plan

1. Verify against HEAD (§10) and append a verification table to this spec.
2. Identify every markdown-to-.docx path and its inline-formatting code.
3. Converge them on one inline parser that emits italic, bold and bold-italic runs. Delete the duplicates.
4. Add tests: a fixture with italics in a paragraph, list item, table cell and heading, plus a literal asterisk in an excerpt block. Assert the run properties in the produced .docx.
5. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of Carry italics from markdown into Word conversion complete!`, then what streamlining and deburring you tried, what you verified and what you assumed without verifying.

## 8. Implementation criteria

1. For each conversion path that writes .docx, a test shows `*X*` producing a run with italic set and no literal asterisks.
2. Italics inside table cells and list items survive (test).
3. Asterisks inside verbatim or code blocks stay literal (test).
4. No more than one inline-emphasis parser remains for docx output.

Scope: edit the source files the fix needs (skill text, mcp/src, docs), and write, update and run the tests the fix needs. Streamline and deburr first: solve the problem by removing, merging or simplifying what already exists, and consider an addition only once those ideas are exhausted. Anything added must be shorter than the text it makes unnecessary, and that text is deleted in the same change. Out of scope, because the orchestrating session runs them once after every spec lands: `build_plugin.py` and `check_plugin.py`. Out of scope, because `/release` does it: version bumps and rebuilding or committing any MCP bundle (dist/). Never build a `.plugin` archive.

## 9. Open questions

- Which tools actually write .docx (vs PDF only)? Should a path that writes only PDF also honour italics? (Likely yes, through the same parser.) **Answered below (Decisions).**

## 10. Verify against HEAD before building

List every tool or script that turns a mockup into .docx or PDF and how each handles inline emphasis today, and run one fixture through each. Record the findings in a table appended here.

## 11. Decisions, 2026-11-26

Made by the orchestrating session's read of HEAD.

- **No MCP tool writes .docx itself.** Python scripts under `source/skills/publish/` do, with six separate inline-emphasis handlers (`fill_general.py` `runs`, `fill_vaniac.py` `_runs`, `fill_ooxml.py` `_append_runs` and `_make_form33_para`, `fill_blocks.py`, and the factum and affidavit paths). One more lives in TypeScript for `drafting_forms__reply_draft` (`source/lawyer/mcp/src/correspondence/docx.ts`, `inlineRuns`), and it is the only one that handles `_x_` and bold-italic correctly. Its semantics (`**` bold, `*` or `_` italic at a word edge, `***` bold-italic, `\` escape) are the model for the one Python parser, which lives in `source/skills/publish/scripts/docx_helpers.py`.
- **Stated exception to criterion 4.** `docx.ts` stays as the one TypeScript parser, because it runs in the Node server and cannot call Python. So one parser per language remains.
- **Likely live bugs (traced in code, not run).** Form 33 citation lines (`> *Name*, ...`) go to `_make_excerpt_para` with italics off, so the Word file prints the asterisks. The factum and the affidavit also print `*x*` literally.
- **Factum authority names.** `fill_factum.py` italicizes every name. It turns roman when the authorities JSON gives `kind` `doctrine` (a secondary source, per the related spec), and stays italic when `kind` is absent.
- **Validators unchanged.** Each form's validator keeps refusing what it refuses today (for example `**` in Form 32). Fenced blocks stay raw.

## 12. Verification against HEAD, 2026-11-26

Fixture `See *Alpha v Beta*, _Gamma Act_ and ***Delta***.` run through each writer's own builder at HEAD (`d5eaec90`). The factum validator refuses `**`, so the factum took `See *Alpha v Beta* and _Gamma Act_.` instead. Runs are shown as `I[...]` italic, `B[...]` bold, `[...]` plain.

| Writer (script, function) | Reaches it from | Output today | Verdict |
|---|---|---|---|
| `publish-general/scripts/fill_general.py` `runs` (body paragraph and `- ` list item, also `re` lines) | `drafting_forms__publish_general`, and `publish/scripts/render_letterhead.py` (letterhead letters) | `[See ] I[Alpha v Beta] [, _Gamma Act_ and ] B[*Delta] [*.]` | `*x*` works. `_x_` prints its underscores. `***x***` prints a stray asterisk on each side and loses the italic. |
| `publish-vaniac-package/scripts/fill_vaniac.py` `_runs` (heading, numbered paragraph, bullet, cite, table cell) | `drafting_forms__publish_vaniac_package` | `[See ] I[Alpha v Beta] [, _Gamma Act_ and *] B[Delta] [*.]` | `*x*` works. `_x_` literal. `***x***` prints asterisks and loses the italic. |
| same, `quote` lines | same | `[See *Alpha v Beta*, _Gamma Act_ and ***Delta***.]` | Verbatim, raw by design. |
| `publish-bcsc-form/scripts/fill_ooxml.py` `_append_runs` with italics on (Form 32 numbered, `> ` excerpt, `>> ` citation) | `fill_parts.replace_part_bodies`, `drafting_forms__emit_form32` then the asm32 fill | `[See ] I[Alpha v Beta] [, _Gamma Act_ and ***Delta***.]` | `*x*` works. `_x_` and `***x***` literal (the asm32 validator refuses `**`). |
| same, `_make_form33_para` (Form 33 numbered) | asm33 fill | `[See ] I[Alpha v Beta] [, _Gamma Act_ and **] I[Delta] [**.]` | `*x*` works, without `<w:iCs/>`. `_x_` literal. A second hand-rolled split. |
| same, `_make_excerpt_para` (Form 33 `> ` line, excerpt or citation) | asm33 fill | `[See *Alpha v Beta*, _Gamma Act_ and ***Delta***.]` | **Bug confirmed**: the citation line `> *Name*, ...` prints its asterisks. |
| same, `_append_runs` with italics off (Notice of Civil Claim, Petition, Response to Civil Claim numbered paragraphs) | Draft-mode fill of those forms | `[See *Alpha v Beta*, _Gamma Act_ and ***Delta***.]` | **Bug**: every asterisk prints. |
| `publish-bcsc-form/scripts/fill_blocks.py` `_fill_affidavit_paragraphs` | `drafting_forms__emit_affidavit` then the asmaff fill | `[See *Alpha v Beta*, _Gamma Act_ and ] B[*Delta] [*.]` | **Bug confirmed**: only `**` is read. `*x*` prints its asterisks. |
| `publish-bcca-factum/scripts/fill_factum.py` `_fill_parts` (opening, numbered, plain, `cite:` lines) | `drafting_forms__emit_bcca_factum` / `publish_bcca_factum` | `[See *Alpha v Beta* and _Gamma Act_.]`, cite `[*Housen v Nikolaisen*, 2002 SCC 33, para 8]` | **Bug confirmed**: no inline emphasis at all. |
| same, `> ` quote lines | same | `[See *Alpha v Beta* and _Gamma Act_. the standard of review ...]` | Verbatim, raw. |
| same, `_fill_authorities` (List of Authorities name) | same | `I[Housen v Nikolaisen] [, 2002 SCC 33]` | Every name italic, `kind` not read (the JSON carries none; the validator refuses any key beyond `authority`, `citation`, `paras`). |
| `lawyer/mcp/src/correspondence/docx.ts` `inlineRuns` | `drafting_forms__reply_draft` | `[See ] I[Alpha v Beta] [, ] I[Gamma Act] [ and ] BI[Delta] [.]` | Correct. The model for the Python parser. |
| `publish/scripts/fill_book.py` (BCCA book and Book of Authorities contents), `publish-boc` `fill_boc.py` and `fill_form63.py`, `publish-bcsc-form` scalar, caption, cover, jurat, service-block and appendix fills, `renumber-affidavit` | their own `publish` routes | Fill from JSON fields or existing .docx text, with no markdown inline emphasis in their input. | Out of scope: no emphasis markup reaches them. |
| PDF: `assemble/*` scripts (`paginate_book.py`, `paginate.py`, `bind_general.py`, `bind_boc.py`, `bind_package.py`, `paginate_record.py`) and `publish-bcsc-form/scripts/steps/shared/render.py` | `assemble_general` and the other assemble routes | Convert a filled .docx to PDF through Word or LibreOffice. None reads markdown. | A PDF carries whatever italics its .docx carries, so fixing the .docx writers fixes the PDFs. |

No path writes footnotes from markdown.

## 13. Implementation, 2026-11-26

- **One Python parser.** `docx_helpers.emphasis_runs` (text to `(text, bold, italic)` runs) and `append_emphasis_runs` (those runs as lxml `<w:r>` elements on a base `<w:rPr>`). Every writer in §12 that read emphasis now calls it, and the five hand-rolled splits are deleted: `fill_general.runs` keeps only its `__underline__` split, then hands each piece to the parser; `fill_vaniac._runs` and `INLINE` are gone; `fill_ooxml._append_runs`, `ITALIC_SPAN` and the `italics` flag are gone, and `_make_form33_para` is `_make_numbered_para` minus the number on `Nil.`; `fill_blocks` and `fill_factum` call `append_emphasis_runs`. `publish-bcsc-form` reaches `docx_helpers` through `fill_ooxml`, as `fill_vaniac` and `fill_factum` already did. `fill_general` and `render_letterhead` now need lxml through it (their "Stdlib only" lines say so).
- **Two safeguards beyond `docx.ts`.** A marker still open at the end of a line prints as itself (`docx.ts` italicizes to the end), and an `_` beside another `_` is literal, so a stray `*` in quoted text or a blank line `____` keeps its characters. A backslash still makes any marker literal.
- **Verbatim text stays raw** where the grammar marks it: publish-general's fenced excerpt, the vaniac fenced quote, and the factum's `> ` quote line. Form 32 and Form 33 `> ` lines are parsed: Form 32 already italicized its excerpts (assembly-input-contract.md), and a Form 33 citation is itself a `> ` line, so the two forms now read alike.
- **Notice of Civil Claim, Petition and Response to Civil Claim** numbered paragraphs, and party captions built by the same helper, now read emphasis too. Before, they printed every asterisk.
- **Factum authorities.** `fill_factum.py` accepts an optional `kind` on each authorities entry and prints a `doctrine` name roman, any other name, or one with no `kind`, italic (bcca-factum-contract.md).
- **Validators unchanged.**
- **Email drafts, later the same day.** The parser moved to `publish/scripts/emphasis.py` (standard library only), which `docx_helpers` imports. `/draft`'s `write_eml.py` loads it by path and prints markdown bold and italic as `<b>` and `<i>` in the email's HTML part, adding that part to a draft with no signature when its body has emphasis. The plain-text part stays the body's exact text.
