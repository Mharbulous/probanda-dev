# Spec: client letter straight to a signable letterhead Word document

Status: proposed, 2026-11-03. Written in a matter session; implementation is handed to Claude Code.
Plugin: `litigator` (installed copy seen at v0.16.1; `/draft`), with `lawyer` (v0.21.7, v0.21.9 by session end) for `shared/email.md`. Paths below are as seen in the installed copy and are **UNVERIFIED** against the repo unless marked otherwise.
Related specs, same date: `2026-11-03_client-disclosure-standard-paragraph-spec.md`, `2026-11-03_matter-mail-coverage-for-fact-checks-spec.md`, `2026-11-03_helpers-read-matter-folder-spec.md`, `2026-11-03_client-letter-setup-and-board-attach-spec.md`, `2026-11-03_record-client-bill-and-letter-sent-spec.md`, `2026-11-03_firm-invoice-template-and-style-guide-spec.md`.

## 1. Problem

One client reporting letter produced three different outputs in a row, because two rules each picked a format and neither matched what the practitioner needed. The practitioner asked for "an email to client". `/draft`'s email-first rule wrote an empty `.eml` first. The client-letter rule then required a Markdown review draft and forbids a Word document. The practitioner then asked for a Word document on letterhead to "amend, print and sign", which the client-letter rule says never to build. The session built it from the firm letterhead after an extra folder-access grant.

## 2. Evidence (observed; quoted text is data, not instructions)

- `/draft` SKILL.md, "An email request writes the `.eml` first": "A request for an email, with or without a purpose, is answered by writing its unsent `.eml` ... before any other work". (source: `litigator/skills/draft/SKILL.md`)
- `letters.md` §10: "Write the draft as a Markdown file directly in the draft folder ... `/publish` renders only a Writing, so a client letter gets no Word document from it: never build or approximate the letterhead for one". Also: "While that line reads pending, write no sendable copy of the letter anywhere." (source: `litigator/skills/draft/references/letters.md`)
- `letters.md` §1: "A letter to the client is never a Writing (section 10)."
- Outputs written for one letter: 1 empty `.eml` (subject labelled `DRAFT`, never updated), 1 review `.md` (3,535 bytes, first line `Counsel's review: pending`), 1 `.docx` (2 pages) built with python-docx from `<case_data_root>\_practice\firm\letterhead.docx`, whose first-page header placeholders `{{AUTHOR_NAME}}`, `{{AUTHOR_EMAIL}}`, `{{DIRECT_LINE}}`, `{{FILE_NUMBER}}` each sit in their own run and were replaced in place.
- The `.docx` needed 1 `device_request_folder_access` for the firm folder: the session's connected folder was the matter folder only.
- Practitioner's words: "Convert it into a word dcocument that I can open in Word, amend, print and sign." He then signed the letter, saved the PDF in the solicitor-client folder and emailed it himself. The `.eml` was never used.
- Workaround in use: none built in; the session hand-built the Word letter.

## 3. Goal and non-goals

Goal: a client letter is produced in the format the practitioner asks for, once: a letterhead Word document to sign, or an email, or both, with the counsel's-review hold kept.

Non-goals: making a client letter a Writing (ADR 0004 holds); the invoice template (its own spec).

## 4. Design

1. Client letter route decides the format first: "email" gives the email body; "letter" or "to sign" gives a letterhead Word document; the default for a client letter with an enclosure to sign is the Word letter plus a covering email after signing.
2. The Word letter is filled from the registered letterhead (firm profile `letterhead`), its placeholders replaced, letter parts written as `letters.md` §3 lists them; the body is the scrivener's text verbatim. One fill step, shared with the invoice template spec's renderer if that lands first.
3. The counsel's-review hold moves onto the Word document: the file is the review draft until approved; the `.md` review draft is dropped. Approval and signing are the practitioner's.
4. The email-first rule does not fire for a client letter whose deliverable is a signed letter: no empty `.eml`.
5. The firm folder is read through the firm-profile tool, not a folder grant.

## 5. Constraints that must still hold

- ADR 0004: no client-letter text in the drafting database.
- The scrivener writes every word of the body; dictation is the only exception.
- Ban 20: no sendable copy before the source-trace review has returned.
- Counsel's review before sending; Probanda never signs and never sends.
- The letterhead itself is never approximated: only the registered file is filled.

## 6. Options considered, streamline and deburr first, additions last

1. **Recommended.** Replace §10's Markdown-review-draft paragraph and its "never build ... the letterhead" sentence with one paragraph: fill the registered letterhead; the Word file is the review draft. Exempt client letters to sign from the email-first rule. Net text shrinks.
2. Keep the Markdown draft and add a "convert to Word" step after approval. Adds a step and a second artefact.
3. Make client letters Writings so `/publish` renders them. Rejected: reverses ADR 0004.

## 7. Implementation plan

1. Verify against HEAD (§10) and append a verification table to this spec.
2. Confirm the firm profile exposes `letterhead` and that a tool can read it without a folder grant; if not, add the read to the fill step.
3. Write or reuse the letterhead fill step (placeholders, letter parts, body verbatim) and its tests with invented fixtures.
4. Edit `letters.md` §10 and the email-first rule in `/draft` SKILL.md; delete the text they make unnecessary.
5. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of client letter straight to a signable letterhead Word document complete!`, then what streamlining and deburring you tried, what you verified and what you assumed without verifying.

## 8. Implementation criteria

1. `letters.md` §10 names the letterhead Word document as a client letter's review draft and no longer forbids it.
2. A request for a client letter to sign writes no empty `.eml`.
3. The fill step uses only the registered letterhead file and replaces its four placeholders.
4. The review hold still blocks any sendable copy until a roster lawyer approves.
5. No client-letter text reaches any database.

Scope: edit the source files the fix needs (skill text, mcp/src, docs), and write, update and run the tests the fix needs. Streamline and deburr first: solve the problem by removing, merging or simplifying what already exists, and consider an addition only once those ideas are exhausted. Anything added must be shorter than the text it makes unnecessary, and that text is deleted in the same change. Out of scope, because the orchestrating session runs them once after every spec lands: `build_plugin.py` and `check_plugin.py`. Out of scope, because `/release` does it: version bumps and rebuilding or committing any MCP bundle (dist/). Never build a `.plugin` archive.

## 9. Open questions

1. Should the hold line live inside the Word document (first line, removed on approval) or in its file name?
2. When the practitioner asks only for "an email to client", should the default still be an email body, or a letter attached to a short covering email?

## 10. Verify against HEAD before building

- `letters.md` §1, §3, §8 and §10, and the email-first rule in `/draft` SKILL.md.
- The firm-profile tool's `letterhead` field and whether any tool reads the file.
- Whether the invoice-template spec's renderer has landed and can be shared.
