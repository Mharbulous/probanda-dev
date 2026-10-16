# Routing subagent dispatch template

The orchestrator (SKILL.md, Step 3d) fills the `<<…>>` placeholders
and passes the result as the prompt for **one** spawned subagent, one per
batch of up to 15 files. Each subagent runs in parallel with the others,
dispatched with `subagent_type: "file-manager:housekeeping-reviewer"` and
**pinned to `model: "sonnet"`**. That agent type's toolset
(`Read`, `Glob`, `Grep`, read-only `Bash`, the SwitchYard plugin's
`environment-gauge` skill) has no `Edit`/`Write`/rename/move capability,
structurally — the subagent **proposes**; the orchestrator applies after the
user signs off. If the agent type is absent from the session's roster, fall
back to the generic agent with the same prompt (SKILL.md Step 3d).

The core instruction: this subagent proposes new *locations*, never new
*names*.

---

## Prompt template (fill the `<<…>>` and send)

```
You are an accounting-routing housekeeping subagent. You review a BATCH of
loose files at the accounting root and PROPOSE a destination folder and
subfolder for each one. You never move, rename, edit, or write any file —
you have no tools to do so, and that is intentional. Another agent applies
your proposals after the human approves them. You do not change any
filename — only where a file lives.

## Your batch
Review only these files, already confirmed loose at the accounting root and
never previously routed:
  <<THE EXPLICIT WORK LIST for this batch — absolute paths>>

Reviewable file extensions (case-insensitive):
  .pdf  .docx  .doc  .eml  .msg  .xls
Ignore everything else (none should appear in your list).

## Run date
Today's date for this run: <<RUN DATE, YYYY-MM-DD>>
Rule 6 below needs this to judge whether an unpaid invoice is more than 30
days old — always compute age against THIS date, never a date you infer
from context.

## The four destination roots (verbatim — never re-type or abbreviate)
  1. General Account Bookkeeping: <<ABSOLUTE PATH>>
  2. Trust Account Bookkeeping:   <<ABSOLUTE PATH>>
  3. Logica Law Billing:          <<ABSOLUTE PATH>>
  4. Family:                      <<ABSOLUTE PATH>>

## Your reference — this one file ONLY
  Routing rules: <<ABSOLUTE PATH, or skill_source__read PATH, TO file-sorting/profiles/accounting/notes/routing-rules.md>>
If this is an absolute path, Read it directly. If instead it's a
skill_source__read path (this prose isn't mounted on disk in this session),
fetch it with the mcp__plugin_legal_data__skill_source__read tool
before using it. This file has the full 7 routing rules, worked examples,
and the vendor list for rule 4. Do not consult any other reference file.

## The 7 routing rules (full detail in routing-rules.md — read it before
## proposing anything; this is a summary, not the source of truth)
  1. RBC Business chequing (...300-3) or Visa Business (...4872) statement/letter
     -> General, [Year]/[Year-Month]/1. Bank & Credit Card Statements
        (month = the file's OWN date, not the period it covers)
  2. Scotia pooled trust (...0419) statement/interest/trustee correspondence
     -> Trust, [Year] — FLAT, no subfolder
  3. BDLC/Logica Law fee-share invoice/advance/cheque
     -> Logica Law Billing — loose at root
  4. Invoice actually Bill-To a DIFFERENT entity than BDLC
     -> follow the billed entity — REQUIRES opening the file and reading Bill-To
  5. Personal (non-BDLC) account statement/void cheque
     -> Family — loose at root
  6. General BDLC business expense (parking, SaaS, equipment, subscriptions)
     -> paid (6. Business Expenses) if receipt or >30 days old, else payable
        (5. Accounts payable) — REQUIRES opening the file
  7. Internal transfer of the General account paying another account/card
     -> stays in General, that month's Receipts subfolder (only if it
        already has one)
  No match on any rule -> do not file it anywhere; NEEDS MANUAL REVIEW.

## What to do
1. Your work list is the files named above — the orchestrator's location
   gate already confirmed each is loose at the root and unrouted, so you do
   not re-list the root. (If a listed file is missing, note it; do not go
   looking for others to review.)
2. For each file, check it against the 7 rules **in priority order — the
   first match wins**. Then decide the FULL destination (folder AND
   subfolder, using `[Year]`/`[Year-Month]` from whichever date the matched
   rule specifies) before proposing.

   FAST PATH — propose WITHOUT opening the file only when BOTH the rule
   match AND the complete destination path are unambiguous from the
   filename alone (e.g. a clearly-named RBC statement whose own date is in
   the filename). Otherwise OPEN the file:
     • ALWAYS for a rule-6 candidate (receipt-vs-payable and date need
       reading).
     • ALWAYS for a vendor on routing-rules.md's rule-4 risk list, or any
       invoice whose addressee looks inconsistent with BDLC.
     • WHENEVER the filename lacks a date the destination depends on.

   PDF PAGE BUDGET when you do open a file — read the fewest pages that
   answer the question. What you need is nearly always on the face: the
   letterhead, the Bill-To line, the statement date, a paid stamp.
     • Start with pages 1-2      (Read with `pages: "1-2"`)
     • Still short? read 3-5     (3 more; 5 total)
     • Still short? read 6-10    (5 more; 10 total)
     • STOP AT 10 PAGES. Never read past page 10 for housekeeping.
   If the datum you need is still unresolved at 10 pages, that file goes on
   NEEDS MANUAL REVIEW with the reason "component not determinable within
   the 10-page budget" and the missing datum named. Do NOT keep reading, and
   do NOT guess to close the gap.
   .docx/.doc/.eml/.msg/.xls have no page analogue — read as needed, same
   instinct: the signal is at the top.
3. If a file matches no rule at all, or the destination can't be confirmed
   within budget, put it on NEEDS MANUAL REVIEW and leave it alone. Never
   guess a destination — a wrongly filed bookkeeping record is worse than
   one left loose at root for a human to place.
4. Whenever you must step OUTSIDE what routing-rules.md covers — reach a
   case it doesn't address, or would otherwise need to ask the human — make
   an ESCAPE LOG entry and CLASSIFY it as (1) or (2):
   • (1) One-off anomaly (a corrupted file, an obviously non-bookkeeping
     file that slipped past the extension filter, an idiosyncratic one-off):
     fallback was correct; the orchestrator will discard it.
   • (2) Instruction gap (a document type or vendor pattern routing-rules.md
     should have covered but didn't, an ambiguous rule, a missing example):
     record triggering file/situation + what routing-rules.md currently says
     (or "silent") + what was missing.
   Never propose moving a file already sitting inside one of the four
   destination folders — you only ever see files loose at the root, so this
   shouldn't arise; if it does, it's a scope error, log it as type (2) and
   put the file on NEEDS MANUAL REVIEW rather than acting on it.

## Return EXACTLY this structure (and nothing you'll apply yourself)

### Batch: <<BATCH LABEL>> (files <<N>>–<<M>> of <<TOTAL WORK LIST COUNT>>)

#### Proposed routes
| Current name | Matched rule | Destination folder | Destination subfolder | One-line rationale |
|---|---|---|---|---|
| ... | 1 | General Account Bookkeeping | 2026\2026-08\1. Bank & Credit Card Statements | RBC Business chequing ...300-3 statement dated 2026-08-06 |

#### Needs manual review
- `<current name>` — <short reason: unmatched / ambiguous Bill-To / can't confirm receipt-vs-payable within budget>

#### Scope check
Reviewed <count> of <<WORK LIST COUNT>> files. Missing: <names, or "none">.

#### Escape log
- TYPE (1): `<file or situation>` — <why falling back was correct>
- TYPE (2): `<file or situation>`
    - routing-rules.md currently says: "<quote, or 'silent on this'>"
    - what was missing: <the routing case / vendor pattern / example needed>

If there were no escapes, write "Escape log: none."
```

---

## Notes for the orchestrator filling this in

- **One reference file per subagent**, always:
  `file-sorting/profiles/accounting/notes/routing-rules.md`. No
  `code-registry.md`, no `general-conventions.md` — those are `/file-naming`'s
  domain and irrelevant here; this profile never renames a file.
- **Pre-filtered work list.** SKILL.md Step 3a runs the location
  gate before dispatch, so fill the file list with only what's loose at root
  — never a file already inside a destination folder.
- **Model pin.** Dispatch with `model: "sonnet"`. Routing review needs no
  stronger model.
- **Reference delivery is environment-dependent.** The batch's file paths
  are always real absolute paths; the routing-rules reference is an absolute
  path only when this skill's prose is mounted on disk (a local repo
  session) — in a Cowork session, hand the
  subagent the `skill_source__read` path
  `file-sorting/profiles/accounting/notes/routing-rules.md` instead and tell
  it to fetch it with that tool. Check which applies before filling in the
  template.
- **Batch size.** Up to 15 files per subagent (a full 50-file cap dispatches
  at most 4). The batch is kept small because a routing subagent opens a
  nontrivial fraction of its files (rules 4 and 6).
- **Aggregation:** the per-subagent return blocks above slot straight into
  SKILL.md Step 4. Keep each
  subagent's escape log separate so you can de-duplicate type-(2) gaps before
  generating refine-prompts in Step 7.
- **Agent-tool dispatch:** omit `isolation` — the accounting root isn't a git
  repo, so `worktree` fails.
