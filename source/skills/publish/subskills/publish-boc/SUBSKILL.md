---
name: publish-boc
description: >
  Fill a BC Supreme Court bill of costs into its final document: Form 62 from
  the totalled context /calculate wrote, or a Form 63 default judgment bill
  through its Schedule 1 engine. Routed to by the explicit publish-boc token, or
  by a practitioner asking to turn an approved bill of costs into the document.
---

# Publish Bill of Costs

Fills one bill of costs. Two routes, and which one applies is settled before
anything is filled:

- **Form 62** — the ordinary bill of costs, tariff items under Appendix B.
  `/calculate` has already gathered, itemized and totalled it.
- **Form 63** — the bill of costs for a **default judgment under Rule 3-8**
  (Rule 14-1 (20)). Schedule 1 replaces the tariff entirely: there are no tariff
  items and no unit value, only the amount involved and the disbursements.

**In Cowork, stop here.** In Cowork (this host grants the data tools as
`mcp__remote-devices__plugin_lawyer_data__<name>`), stop before any tool
call or file write. This step runs on the PC, in a Claude Code session in the
desktop app's Code tab, where the Probanda plugin is installed, not in a
Cowork cloud sandbox, which cannot see the matter or matter-data folders (ADR
0026). Tell the practitioner so, and how to run it there: open a Code-tab
session in the matter's folder and ask for the same publish step. Do not
retry or probe in Cowork.

Both read the shared working folder
`{matter-data folder}/bill-of-costs/`, the matter-data folder being the one
`probanda.json`'s `case_data_dir` names. A bill of costs is an individual
document, so per the workspace output rule
(`.claude/skills/shared/workspace-output-rule.md`) its `.docx`, Form 62's or
Form 63's, is written at the top of the draft folder as `<stem>.docx`: the
draft folder is the one folder matching `0. DRAFT*` under the matter (none, or
more than one, fails loudly; never create it). Form 63's `.md` mockup stays in
its Writing folder, `<draft folder>/<writing folder>/`, where `<writing folder>`
is the name the caller passes, or for a bill with no Writing a
`{CODE} {description}` folder named by `/file-naming`'s grammar, created if
absent.

**Name the bill.** Compose the stem from the bill under `/file-naming`'s
grammar (no ` vN`, no extension) and run its gate on it. On a fail, or a date
or code you cannot pin down, ask the practitioner; never fall back to a fixed
name. The scripts refuse a stem that is empty, carries a character Windows
forbids in a file name, ends in an extension or ends in ` vN`
(`error: bad_input`), and a draft folder that is not there
(`error: no_out_dir`), before writing anything.

**Never overwrite a bill.** Both routes' Word output follows the workspace
output rule: an existing `.docx` is never overwritten, renamed or deleted. When
the stem is already taken, the script writes the next ` vN` (one above the
highest copy present), prints that path on its `Written:` line, and names the
copy it passed over on a `Versioned from:` line. Tell the practitioner, in case
it is another bill's, then present the printed path as current per the
workspace output rule. That printed path is the bill: use it in the verify
step, report it to the practitioner, and give it to `assemble-boc` as
`bill_docx`. Form 63's `.md` mockup is the exception, rewritten in place on
every run.

Practitioner input renders per `.claude/skills/shared/elicitation-widget.md` —
plain chat text only as that file's fallback rung, never as the primary ask.

## Resolving the scripts

In a repo checkout, run them from the repo root as
`python .claude/skills/publish/subskills/publish-boc/scripts/<script>`.

`fill_boc.py` finds `subskills/publish-boc/templates/062-boc.dotx` itself, and
`fill_form63.py` finds `063-djboc.dotx` the same way, relative to this subskill's
own folder — the scripts and the templates ship side by side, and that is what
makes it work.

## Form 62

1. Read `boc-context.json` from the working folder. That file is the whole input:
   it carries every computed total. If it is not there, `calculate-boc` has not
   run or was not approved — say so and stop. Do not re-derive totals here, and do
   not read `bill-of-costs.json` to patch a gap in the context.

   The schema is `references/boc-context.md`.

2. Compose the stem (**Name the bill** above), then fill:

   ```bash
   python .claude/skills/publish/subskills/publish-boc/scripts/fill_boc.py \
       --context "<working folder>/boc-context.json" \
       --out-dir "<draft folder>" --out-name "<stem>"
   ```

3. Verify the path the script printed on its `Written:` line, which carries a
   ` vN` suffix when an earlier bill already held the name:

   ```bash
   python .claude/skills/publish/scripts/verify.py "<the printed .docx path>"
   ```

   Report the printed path to the practitioner, with any residual
   unsubstituted placeholder.

## Form 63

Schedule 1 banding and every subtotal are computed by the engine. Compose no
figure and no layout in chat.

1. **Ask for the amount involved.** One elicitation form: the amount in a short
   numeric input, a `.elicit-textarea` for its basis (pleaded in the Notice of
   Civil Claim, sworn, or as the practitioner instructs), and a "No amount
   involved" pill for a judgment with none. The amount and the "no amount" pill
   are mutually exclusive — the engine rejects both together and rejects neither.

2. **Build `form63-context.json`** in the working folder from the state file's
   header, its disbursements, and the answer above:

   - `plaintiffs` and `defendants` — the role-keyed party lists from the header.
   - `party_claiming_costs`, `court_file_number`, `registry` — from the header.
   - `amount_involved` — a decimal string, or `no_amount_involved: true`.
   - `amount_involved_basis` — the practitioner's own words.
   - `disbursements` — one entry per state-file row, `{description, amount}`. Each
     row's `claimed` becomes `amount`, **as a decimal string**: the engine rejects
     a float outright and requires an amount on every row.

3. **Render.** Compose the `.docx` stem (**Name the bill** above), then:

   ```bash
   python .claude/skills/publish/subskills/publish-boc/scripts/fill_form63.py \
       --context "<working folder>/form63-context.json" \
       --out "<draft folder>/<writing folder>/YYYY-MM-DD Form 63 Default Judgment BOC <PartyShort> DRAFT.md" \
       --docx-dir "<draft folder>" --out-name "<stem>"
   ```

   Two files, two surfaces. The `.md` is the **mockup**: the practitioner's
   review surface, never filed, in the Writing folder. The `.docx` is the
   **filed face**: the text as delivered to the registry. `--docx-dir` with
   `--out-name` fills `subskills/publish-boc/templates/063-djboc.dotx` and
   writes it at the top of the draft folder as `<stem>.docx`, at the next
   ` vN` if that name is taken; the second `Written:` line names the `.docx`
   actually written, and a `Versioned from:` line any copy passed over. Both
   carry the same content. Every figure on
   both comes from one engine call, so they cannot disagree. Pass `--docx-dir`
   and `--out-name` whenever the bill may be bound — `/assemble`'s
   `assemble-boc` takes the `.docx`, never the markdown.

   `063-djboc.dotx` is a reconstruction of the prescribed form, built from the
   layout the engine renders rather than converted from a supplied Word document
   (issue 713, open question 1). The binary is the source of truth: it is edited
   in Word, never regenerated.

4. **Verify the filed face** (the `.docx` the second `Written:` line printed):

   ```bash
   python .claude/skills/publish/scripts/verify.py "<the printed .docx path>"
   ```

   `[dd/mmm/yyyy]` is the only placeholder that may survive — the assessing
   officer dates the assessment. Anything else residual is a fill that failed.

5. Present the `.md` and the printed `.docx` path. Do not re-derive the
   layout or any subtotal in chat.

The Schedule 1 bands and their re-verification status are
`references/schedule-1.md`.

## Boundaries

- **Do not gather, itemize or total.** Those are `/calculate`'s
  `gather-disbursements`, `itemize-boc` and `calculate-boc`. If the context file
  is missing or wrong, send the practitioner back to the member that owns it.
- **Do not bind.** Binding the bill with its receipts is `/assemble` with
  `assemble-boc`. Stop when the document is filled and verified, and say that
  binding is available; never open the binder automatically.
