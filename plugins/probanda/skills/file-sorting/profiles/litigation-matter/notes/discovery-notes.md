# Discovery folder notes (folder type 7)

Scope: documents from the discovery process — examinations for discovery,
notices to admit and their replies, and document-disclosure materials.

## Codes typically used here

`XFD`/`EFD`, `NTA`, `RTNTA`, `LOD`. Look up definitions in `code-registry.md`.

## Judgment calls

- **`XFD`/`EFD` (examination for discovery):** name the examinee in
  `LastnameF` form and use the date of the examination.
- **`NTA` is frequently served** — apply the `srv` test from
  `general-conventions.md` to the operative language.
- **`LOD` numbering:** append `#1`, `#2`, etc. for sequential lists. The
  author/recipient is the party whose list it is. Schedule attachments follow
  the same prefix (e.g. `LOD#1 DuckworthS Schedule A.pdf`).
- **Amended lists of documents:** a List of Documents that formally *amends*
  an earlier LOD (rather than replacing it with a new sequential list) uses
  the code `ALOD#<n>`, where `<n>` matches the LOD number it amends (so a
  first amendment to `LOD#1` is `ALOD#1`, not `LOD#2`). Use the amendment's
  own signing/service date. Example: an amendment to Praneeta Prasad's
  `LOD#1`, signed 26 June 2026 → `2026-06-26 ALOD#1 PrasadP.pdf`. Contrast
  with a genuinely new, freestanding LOD from the same party (not an
  amendment to a prior one), which still gets the next sequential `LOD#<n>`.

## Listed documents (the disclosed documents themselves)

A document that appears as a numbered item on a party's LOD leads with its
position on that LOD, not with a Bates number and not with a generic content
description. The firm's ordinary naming grammar then follows that position:

`[Party][Part].[No] - YYYY-MM-DD CODE Party re/encl/srv Subject.[ext]`

- **Party** — `P` for the Plaintiff's LOD, `D` for the Defendant's LOD. If
  there are more than two parties (or P/D would be ambiguous — e.g. multiple
  plaintiffs or defendants), use the party's name instead (e.g.
  `Praneel2.03 - …`, `Praneeta2.03 - …`). The party letter is part of the item
  number wherever it is written, **including in the filename** — it is never
  dropped, not even on the Plaintiff's side.
- **Part** — the Part number the document falls under on the LOD (e.g. Part 1
  — documents in the party's possession available for inspection; Part 2 —
  other documents for use at trial; per Rule 7-1).
- **No.** — the item number in that Part's table on the LOD, zero-padded to
  two digits (e.g. `03`, not `3`). Zero-padding exists to keep multi-item
  Parts sorting correctly; a Part with a single item has no such need — skip
  padding for single-item Parts (`D1.1`, not `D1.01`). Once a Part
  grows past its first item, pad all its files together in one pass.
- **` - `** — a single space-hyphen-space, once, between the item number and
  the date. Do **not** add a second hyphen between the date and the code:
  `P1.57 - 2025-03-18 LF MPP re payout.pdf` is right;
  `P1.57 - 2025-03-18 - LF MPP re payout.pdf` is wrong.
- **`YYYY-MM-DD CODE Party re/encl/srv Subject`** — the firm's standard
  date + code + author/recipient + re/encl/srv + subject grammar from
  `general-conventions.md` and `code-registry.md`, applied exactly as it would
  be for any other document. The LOD item number takes the place a plain
  filename would otherwise start from; everything after the hyphen is built
  the ordinary way.
- **ext** — the document's own file extension; this rule applies to any file
  type, not just PDFs (audio/video exhibits, e.g. `.m4a`, get the same
  treatment).

To assign these, open the current, most recently dated LOD in the same folder
and match each loose file to its row by date/description, using the Bates
range too when that column is populated. **The Bates-range column is
frequently blank** (it's filled in at production time) — when it is, match on
the document's own content (dates, signatures, letterhead) instead. That's the
normal fallback, not an improvisation; treat a populated Bates range as
corroboration when present. State the match basis (Bates or content) in the
rename's rationale, then rename to the full form above.

**Worked example** — from a LOD's Part 2 table:

No. 3, Date 2025-09-11, Description "Photo of 'Forks Spoons' label...", Bates
Range PRANEEL0010–PRANEEL0012

→ if this is the Defendant's LOD, the item-number prefix is `D2.03` and the
file is renamed `D2.03 - 2025-09-11 …`, where `…` is the ordinary date-onward
name the document would carry anyway (code, party, re/encl/srv, subject) per
`general-conventions.md`. The code and subject come from the document itself,
so this example fixes only the prefix and the date — not the tail.

**Numbering survives amendment.** When a List of Documents is later amended,
already-named exhibit files **keep their original item numbers** — they are
not renumbered to match the amended list. (Same principle as `ALOD#<n>` above,
now extended to the listed documents themselves.)

**Legacy bare-numbered files.** Some LOD folders still hold files named as a
bare item number only (`1.1.pdf`, `D1.1.pdf`, `D2.01.pdf`) — an earlier format
with no date, code, or subject, and sometimes no party letter. **Leave them
alone.** Bringing them in line with the format above is separate, explicitly
scoped future work; do not propose renames for them on a routine housekeeping
pass.

Do not carry the file's original Bates-numbered name (e.g.
`Duckworth0067.pdf`) or a generic description forward — the LOD position is
the canonical identifier once a LOD has been served, because it's what gets
cited in pleadings, affidavits, and at trial.

If a loose file cannot be matched to any row on the current LOD (superseded
schedule, misfiled item, or the LOD hasn't been finalized yet), leave it on
manual review with a note — don't guess at a Part/No. pairing.

## Known thin spots

No dedicated codes for: document briefs / disclosure bundles (produced or
received), demand for discovery of documents. Do NOT invent codes — leave on
needs-manual-review and log type-(2).

## Misfile test

Is the document a bare filed pleading or an order with no discovery purpose?
If yes, it belongs in Court File (type 5) — type-(1) escape.
