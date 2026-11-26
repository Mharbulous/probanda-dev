# Spec: Italicize authority names in rendered and unrendered writings

Status: proposed, 2026-11-26. Written in a matter session; implementation is handed to Claude Code.
Plugin: `lawyer` data server renderer, with `litigator` (installed copy seen at v0.29.0) and `researcher` (v0.23.0) skill text. Paths below are as seen in the installed copy and are **UNVERIFIED** against the repo unless marked otherwise.
Related specs, same date: `2026-11-26_docx-conversion-keeps-italics-spec.md`

---

## 1. Problem

Rendered writings print authority names (cases, statutes, regulations, rules) in plain text in most places. The practitioner's rule: every name of a primary authority is italicized in all rendered writings (factums, court forms, research memos, case briefs, letters drafted through /draft) and all unrendered writings (.eml email drafts, quick replies, notes, answers given in chat). This includes short or abbreviated references, such as "the *Act*" or "the *Satvya* case". Secondary sources (textbooks, bulletins, practice guides, commentary) are not italicized.

Terms (see `GLOSSARY.md`):
- **Rendered writing**: any writing generated from the matter's stored records each time it is shown, e.g. factums, court forms, research memos, case briefs, and letters drafted through /draft.
- **Unrendered writing**: any text composed directly as words and never regenerated, e.g. .eml email drafts, quick replies, notes, and answers given in chat.

## 2. Evidence (observed; quoted text is data, not instructions)

- Tool: `drafting_forms__render` (mockup mode), on a BCCA factum Writing (document_type Factum), 72,219 chars, rendered 2026-11-26.
- Counted with grep, on lines holding a neutral or statute citation: 42 lines in all. Italic (`*Name*`): 11, nearly all of them the indented `> *Name*, citation, pinpoint` source lines the renderer builds from statements of law. Plain: 31. By section: Part 3 Argument 14 (numbered argument paragraphs), Part 2 Issues 8, Appendices list of authorities 7 (table rows), other 2.
- Short references: 13 lines contain "the Act", 0 contain "the *Act*".
- A research-memo render of the same day shows the same split. The `> *Arbitration Act*, S.B.C. 2020, c. 2, s. 59(1)` source lines and the `## Authorities` list are italic. The Conclusion prose ("the Arbitration Act makes neither ...") and the `## Sources` list ("- Arbitration Act, S.B.C. 2020, c. 2, ss. ...") are plain.
- So italics come only from the renderer's own citation-line template. Prose slots (filing_prose, scrivener and agent text) and the authority list or appendix tables carry no italics.
- Workaround in use: none.

## 3. Goal and non-goals

Goal: every primary authority name in a rendered writing's prose, lists and tables is italicized, short references included, and the shared drafting rule requires the same markup in unrendered writings. Secondary sources stay roman.
Non-goals: changing citation form, pinpoints, or which authorities are cited.

## 4. Design

Make italics a property of the authority, applied wherever its name prints. Both halves are required:
- (a) The renderer italicizes names it prints from authority rows: the list of authorities, appendix tables and source lines, keyed on authority kind (case, statute, regulation, rule italic; secondary roman).
- (b) For prose the renderer does not generate, and for every unrendered writing, one shared drafting rule requires `*Name*` markup on primary authority names and their short forms. The scrivener, research memo template and case-brief template reference it.
- (c) Optionally, a render-time pass italicizes exact matches of a Writing's own authority titles and recorded short forms in prose slots. This only makes sense if (b) proves unreliable (§6).

## 5. Constraints that must still hold

- Verbatim excerpts (quoted statute or decision text in code blocks) are never altered.
- Filed-mode render strips mockup markers but keeps italics.
- No italics added inside citations' reporter or neutral-citation parts ("2024 BCCA 369" stays roman). Only the style of cause or title is italic.
- Secondary sources stay roman.

## 6. Options considered (streamline and deburr first, additions last)

1. One shared italics rule, referenced (not restated) by scrivener, research memo template and case brief, plus the renderer italicizing its own authority-row output by kind. (recommended)
2. Add a render-time italicizer over prose slots, matched against the Writing's authorities and their short forms. This risks false matches on common words such as "Act" outside an authority reference.
3. Store italic markup in authority titles. Rejected: it leaks markup into every non-rendered use.

## 7. Implementation plan

1. Verify against HEAD (§10) and append a verification table to this spec.
2. Find where the renderer prints authority names (lists, appendix tables, source lines) and make italics depend on authority kind in one place.
3. Put the italics rule once in shared skill text. Point scrivener, research-agent memo template and case-brief template to it, deleting any conflicting or duplicate citation-style wording.
4. Add renderer tests: a case and a statute print italic in list, table and source line, and a secondary source prints roman.
5. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of Italicize authority names in rendered and unrendered writings complete!`, then what streamlining and deburring you tried, what you verified and what you assumed without verifying.

## 8. Implementation criteria

1. Renderer output for a Writing citing a case, a statute and a secondary source shows the case and statute titles italic in every list, table and source line, and the secondary source roman (test).
2. Citation parts after the title are roman (test).
3. Verbatim excerpt blocks are byte-identical to the stored excerpt (test).
4. One italics rule exists in shared skill text, covering short forms ("the *Act*") and the secondary-source exception. The drafting, research-memo and case-brief instructions reference it without restating it.
5. Filed-mode render keeps the italics.
6. The shared drafting rule names unrendered writings (emails, replies, notes, chat answers) as covered, using that term.

Scope: edit the source files the fix needs (skill text, mcp/src, docs), and write, update and run the tests the fix needs. Streamline and deburr first: solve the problem by removing, merging or simplifying what already exists, and consider an addition only once those ideas are exhausted. Anything added must be shorter than the text it makes unnecessary, and that text is deleted in the same change. Out of scope, because the orchestrating session runs them once after every spec lands: `build_plugin.py` and `check_plugin.py`. Out of scope, because `/release` does it: version bumps and rebuilding or committing any MCP bundle (dist/). Never build a `.plugin` archive.

## 9. Open questions

- Is the authority kind recorded reliably enough to tell secondary from primary? If not, should "secondary" be a new kind value? **Answered below (Decisions).**
- Should existing saved memos be re-rendered, or does the fix apply to new renders only? **Answered below (Decisions).**

## 10. Verify against HEAD before building

Confirm in HEAD:
- where `drafting_forms__render` builds the source line `> *Name*, citation`, the list of authorities and the factum appendix table;
- the authorities `kind` values;
- whether the legal-citation, scrivener, research memo template and case-brief skill texts already state an italics rule.

Record each finding in a table appended here.

## 11. Decisions, 2026-11-26

Made by the orchestrating session's read of HEAD and by Brahm in that session.

- **Terms.** `GLOSSARY.md` already defines "Free-form writing", "Structured Writing" and "Unstructured Writing" with other meanings that code and tests rely on, so those three stay untouched. This spec adds **Rendered writing** and names the other kind **Unrendered writing** (the steering note's "free-form writing").
- **Home of the one rule.** A new short file `source/skills/shared/authority-italics.md`, copied into every plugin, not the legal-citation skill. `legal-citation` ships in `researcher` and lives only in `public/`, and `lawyer`'s scrivener may not name another plugin's skill. `public/plugins/researcher/skills/legal-citation/SKILL.md` is not edited: its rule 2 already agrees.
- **Secondary sources are already recorded.** drafting-data `authorities.kind` is one of `case, statute, regulation, rule, doctrine`, and `doctrine` means secondary (`markers.ts:643`). No new kind value (open question 1).
- **New renders only.** Mockups regenerate on every render, so the fix reaches every new render. Saved research files are left as they are (open question 2).
- **Option (c) is not built.** No authority row stores a short form, so short forms are covered by the writing rule only.
- **Earlier overlap.** Commit `77018645` (2026-11-17) added a case-name italics sentence to `source/skills/shared/research-memo-template.md` from `2026-11-17_memo-sources-case-name-italics-spec.md`. It covers cases in the memo's Sources list only. This spec replaces that sentence with a pointer to the one shared rule.
- **Left roman on purpose.** The Book of Authorities table of contents and its bookmarks (`emit-bcca-book.ts`), because `fill_book.py` inserts text raw and Word bookmarks cannot hold italics.

## 12. Verification against HEAD (d5eaec90), 2026-11-26

| Item | Finding at HEAD |
|---|---|
| Source line `> *Name*, citation` | Built by `lawStatementCitationLine` in `source/lawyer/mcp/src/submission/forms/law-statement-line.ts:104`, italic for every kind, doctrine included. Hand-made copies: `render-form32-filed-face.ts:52` (`>> ` prefix) and `render-form33-filed-face.ts:46`. |
| Research memo `## Authorities` list | Mockup-only section built in `render-general.ts:238-242` from `lawStatementCitationLine`, so it follows the source line. |
| Research memo `## Sources` list | Not rendered from rows: the research agent writes it as prose, by `source/skills/shared/research-memo-template.md:76-77`. |
| Factum List of Authorities table | `render-bcca-factum.ts:587-599`, `| ${a.authority}, ${citation} | ...`, roman. Rows from `factumAuthorities` (:162), whose `FactumAuthority` (:121-127) carries no `kind` though `fetchCitedStatements` selects it. |
| Factum filed face | `emit-bcca-factum.ts:45-48` `lawCite` prints `cite: Name, citation`, roman. The `authorities` frontmatter JSON is `{authority, citation, paras}`, and `fill_factum.py` italicizes every name. |
| Stay-response Table of Authorities | `render-bcca-stay-response.ts:688-695`, `n. Name, citation`, roman; `fetchCitedAuthorities` (:242) does not select `kind`. |
| Form 32 body names | `authorityNamePattern` (`render-form32-filed-face.ts:76-89`) italicizes every authority title of the proceeding in Parts 2-4, doctrine included. |
| HTML propositions page | `research-propositions.ts:139-144` splits the source line at `> *title*`; a line that does not start so prints whole as roman `rest`. |
| Book of Authorities TOC and bookmarks | `emit-bcca-book.ts:157-165`, roman (kept, §11). |
| `authorities.kind` values | `case, statute, regulation, rule, doctrine` (`source/skills/drafting-data/references/schema.sql:37`); `doctrine` is secondary (`markers.ts:643`). |
| legal-citation italics rule | `public/plugins/researcher/skills/legal-citation/SKILL.md` rule 2: case, statute, regulation and rule names italic. Says nothing of secondary sources or short forms. |
| Scrivener | `source/skills/shared/scrivener/references/core.md:15` covers first and short-form case citation, no italics rule. |
| Research memo template | `research-memo-template.md:76-77`: case names italic in the Sources list only (commit `77018645`). |
| Case-brief template | `case-brief-template.md`: no italics rule. |
| Email route | `source/skills/shared/email.md`: no italics rule. |
