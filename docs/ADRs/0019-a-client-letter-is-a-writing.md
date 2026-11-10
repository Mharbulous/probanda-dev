---
status: accepted
date: 2026-11-09
---

# A client letter is a Writing

A letter to the client was kept out of the drafting database. It had its own route (`letters.md` section 10, `client_letter_fill`), and the type lookup that finds every other letter refused the recipient `client`. A session asked for a blank client letter found no type, concluded there was no script route, and built the page by hand with python-docx. The practitioner corrected its layout six times. The script that draws a letterhead letter, `render_letterhead.py`, already existed and was never reached.

The practitioner ruled on 2026-11-09 that a client letter is a structured Writing like any other letter.

## Decision

- **One type, one lookup, one renderer.** `letter-to-client` sits in `_NoVenue/Documents/kinds.json` with recipient `client`. It is found by the same lookup as every other letter and drawn by `render_letterhead.py`. Its body is written by `lawyer:scrivener` only.
- **The privilege marker is a layout field.** The type declares `"marker": "SOLICITOR CLIENT PRIVILEGED"`. `fill_general.build_body()` prints it as one bold line between the date and the recipient address. A scrivener spawned with `mode: without-prejudice` replaces it with `WITHOUT PREJUDICE`.
- **Counsel's review is the Writing's own.** A client letter carries the `counsel-review` criterion and its pre-send hold, as every Writing for delivery does.
- **The parallel route is removed.** `client_letter.py`, the harness steps `client_letter_fill` and `client_letter_approve`, and the attachment hold gate go. The `client_letter` value of `board_attachments.kind` stays, so a letter attached before this change still shows on its board. Nothing creates new ones.

This supersedes the client-letter clause of CoClerk ADR 0004 (`docs/adr/0004-submission-single-database-privilege-by-kind.md`) and the client-letter half of CoClerk ADR 0042, which attached a client letter to a board by a path only.

## Reason

A deterministic layout. A page drawn by a script comes out the same every time, and the practitioner corrects only the words.

## Consequences

- Solicitor-client letter text is stored in the matter's drafting database, which is on the User's Machine only. Commandment 3 permits this. It never reaches Probanda's Cloud.
- A client letter now has a Work Board, a Goal card and 🧐 like any other Writing.
- The 2026-11-03 client-letter specs (`client-letter-word-on-letterhead`, `client-letter-setup-and-board-attach`, `record-client-bill-and-letter-sent`) are superseded for client letters by this record.
