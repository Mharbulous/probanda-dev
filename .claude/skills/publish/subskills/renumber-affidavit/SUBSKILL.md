---
name: renumber-affidavit
description: >
  Change the number of an unfiled, unsworn draft affidavit (Rule 22-2(3): "This
  is the 1st affidavit of ...") by writing renumbered copies of its Word drafts,
  and swap its folder name on the practitioner's yes. Routed to by the explicit
  renumber-affidavit token, or by a request to renumber an affidavit or swap two
  affidavits' numbers.
---

# Renumber an affidavit

Gives an existing draft affidavit a new number. It writes a renumbered copy of
each Word draft beside the old one and keeps tracked changes and comments. On
the practitioner's yes it renames the affidavit's folder. It never edits, overwrites,
renames or deletes a Word draft, and it never hand-edits Word XML or renames with
the shell. Every edit goes through `renumber_affidavit.py`, and every
rename goes through `/file-apply`'s apply, in the `file-manager` plugin.

**In Cowork, stop here.** In Cowork (this host grants the data tools as
`mcp__remote-devices__plugin_legal_data__<name>`), stop before any tool
call or file write. This step runs on the PC, in a Claude Code session in the
desktop app's Code tab, where the Probanda plugin is installed, not in a
Cowork cloud sandbox, which cannot see the matter or case-data folders (ADR
0026). Tell the practitioner so, and how to run it there: open a Code-tab
session in their Coclerk checkout and ask for the same publish step. Do not
retry or probe in Cowork.

Run the scripts from the repo root. The draft folder is the matter's one
`0. DRAFT*` folder (none, or more than one, fails loudly).

## Steps

1. **Fix the targets.** Take the new number for each affidavit from the
   practitioner's words, and never infer one from a draft's name, header or
   folder (the Form 109 style guide's ordinal rule). "Reverse the order" of two
   affidavits states both numbers. Repeat each deponent, affidavit and old → new
   number back before anything is written.

2. **Refuse a sworn or filed affidavit.** An affidavit's number is fixed once it
   is sworn, affirmed or filed, whichever comes first. Check before asking:
   - Ask `/case-data` whether the matter records this affidavit as sworn,
     affirmed or filed. If it has no record of it, say so. A missing record is
     not "draft".
   - List the matter's court-file folder (`5. COURT FILE*`) for copies of this
     affidavit: by name, or by a review PDF of it whose hash matches a
     court-file PDF. A court-file copy counts as filed unless its name is marked
     `UNSWORN` or `DRAFT`.

   Refuse when either source shows it sworn, affirmed or filed. Ask the
   practitioner one question only when neither source settles it.

3. **Inventory.** Probe every `.docx` under the draft folder, subfolders
   included. A row is this affidavit when its identifier paragraph names the
   deponent at the old number:

   ```
   python .claude/skills/publish/subskills/renumber-affidavit/scripts/renumber_affidavit.py <probe.json>
   ```

   `{"mode": "probe", "source": "<abs .docx>"}` returns each identifier found,
   its number and paragraph text, and whether the file holds tracked changes or
   comments. Show one table: file, modified time, number found, tracked changes
   or comments. Propose
   a renumbered copy for every row at the old number. A row already at the new
   number is skipped and shown. Below the table, list without renumbering:
   matching files outside the draft folder, and review PDFs at the old number.
   Then propose the folder rename: the folder's name with the number token
   swapped (`AFF#1 ChenM` → `AFF#2 ChenM`), as a two-way swap when two
   affidavits trade numbers. Ask once: which rows to strike, and whether to
   rename the folders.

4. **Write the copies.** For each row kept, name the copy by the source's own
   name with the number token swapped (`AFF #1`, `AFF#1`, `Affidavit #1`), beside
   its source. Take the next ` vN` if that name is taken, or if the name carries
   no number token. Run `/file-naming`'s gate on each name and report its verdict.
   The verdict does not block a copy. Then run the script with
   `{"mode": "write", "source": ..., "out_path": ..., "old_number": N, "new_number": M}`.
   On any refusal, report it for that file and carry on with the rest. Never
   work around a refusal by editing the file another way.
   - `ordinal_in_tracked_change`: ask the practitioner to accept or reject that
     revision in Word.
   - `identifier_not_found`, `identifier_ambiguous` or `identifier_split`: the
     practitioner changes that copy's number in Word.

5. **Rename the folders** only on the practitioner's yes, after every copy is
   written. Build one `/file-apply` apply manifest holding every folder pair
   (a swap runs all-or-nothing with no temporary name left behind), with
   `expected_total` set to the count shown. Report `/file-naming`'s gate
   verdict on each new folder name. If `/file-apply` is not available in this
   session, the `file-manager` plugin is not enabled: rename nothing, tell the
   practitioner that this step renames a folder and needs `file-manager`, and go
   on to step 6 with the folders unrenamed. Never fall back to a shell `mv` or
   `rm` or the Write tool.

6. **Close.** Name each new copy as current, at its path after any folder rename,
   and list each original as superseded. Ask which to send to TRASH
   (`file_ops__trash`), and act only on the answer. If `file_ops__trash` is not
   available in this session, the `file-manager` plugin is not enabled: trash
   nothing, and tell the practitioner that sending a copy to TRASH needs
   `file-manager`. Never fall back to a shell `mv` or `rm` or the Write tool. Then list every reference left
   at the old number, each with the place where it is changed:
   - review PDFs: rebind the renumbered `.docx` with `/assemble`
     `assemble-affidavit`, and offer the old PDFs to TRASH on the same answer;
   - a filing's list of affidavits, such as a Notice of Application's Part 4
     entry: the filing's own drafting route;
   - case data's record of the affidavit: `/case-data`;
   - the Job Board's affidavit number: `/drafting-data`.

   Change none of these here.
