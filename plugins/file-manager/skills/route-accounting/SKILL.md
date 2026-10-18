---
name: route-accounting
disable-model-invocation: true
description: In the firm's accounting root, review loose bookkeeping files and route each one to its destination folder, after the user approves a routing plan. Use for 'route-accounting', or to sort/file loose accounting documents. Covers .pdf/.docx/.doc/.eml/.msg/.xls.
---

<!-- file-manager v0.6.0 -->
> **Installed copy.** This skill's full source tree ships beside this file, and a relative path in the text below cites that tree. Resolve one by trying, in order: the directory of the file you are reading, then `${CLAUDE_SKILL_DIR}/<path>`, then `${CLAUDE_SKILL_DIR}/../<path>` (so `shared/x.md` is at `${CLAUDE_SKILL_DIR}/../shared/x.md`). The host substitutes `${CLAUDE_SKILL_DIR}` with the directory holding this SKILL.md when this file loads; if the literal text `${CLAUDE_SKILL_DIR}` is what you see, that IS the definition: it means the directory containing this SKILL.md, not a placeholder to search for or guess. Read references and shared files natively from there, never over the litigation data server's skill-source tool and never by requesting folder access; scripts and templates the text declares are executed and read from there too. If `${CLAUDE_SKILL_DIR}` itself no longer exists, the plugin was re-synced mid-session: list only `${CLAUDE_SKILL_DIR}/../../..` (the folder that held this plugin's folder), take the folder named as this plugin's folder with any `~g<N>` suffix removed plus the highest `~g<N>`, and repeat the same three tries with its `skills/<this skill>` directory in place of `${CLAUDE_SKILL_DIR}`; tell the user once that the plugin updated mid-session, from the version in this file's version comment to the version in that folder's copy of this SKILL.md. If a file the text names is missing at every one of those paths, including the re-synced folder's, STOP and report the exact path and error to the user rather than substituting an alternative: do not re-derive a script's logic from its source text or the prose, and do not search elsewhere on the filesystem. Ask the user to reinstall the plugin and fully restart the app; this may fix it, but STOP means stop regardless: do not diagnose further yourself.
> **HTML pages.** Every HTML file this plugin writes is a human interface generated from its databases; an agent never views, reads, greps, parses, scripts over, stages, authors or requests a screenshot of one, but may present one to a human user to view, and may view a screenshot the user provides on their own initiative. The rule and the data to use instead: `shared/html-pages.md`.

## Contents

| Section | Read when |
|---|---|
| Architecture at a glance | Always, to see the run's steps and its working file |
| Step 0 — Model gate: this skill does not run above Sonnet | Every run, first, before any other step |
| Arguments | A folder path is supplied with the command |
| Step 1 — Find the folder to review | Resolving which folder and filing profile to review |
| Step 2 — Decide what's in scope | Fixing the in-scope files and routing rules from the profile |
| Step 3 — Gate, cap, then dispatch (in parallel) | Listing loose root files, capping at 50, and dispatching reviewer subagents |
| Step 4 — Aggregate the subagents' returns | Subagents have returned and the plan must be reconciled and written to disk |
| Step 5 — Present the combined plan and get approval | Presenting the plan, or re-reading it after a context compaction |
| Step 6 — Apply the approved changes | The user has approved routes and they are to be moved |
| Step 6.5 — Resolve "needs manual review" items one at a time | Manual-review items remain after the apply pass |
| Step 7 — Emit a "review and refine" prompt for each type-(2) gap | The run logged type-(2) instruction gaps |

# Route accounting (orchestrator)

In the firm's accounting root, route loose bookkeeping files to their
destination folders. This skill runs only against a profile whose **Kind**
(`/file-sorting`'s detect-profile intent) is `route-to-destination` — the
accounting root. **You are the orchestrator.** You do not review files
yourself. You decide what's in scope — loose root files — dispatch
specialized subagents to review it **in parallel**, then aggregate their
results, get the user's approval, apply the approved routes, and — at the
very end — hand the user ready-to-use prompts for fixing any gaps the run
exposed in the subagents' own instructions.

The routing rules exist so bookkeeping records land where the firm's
accounting already expects to find them. **A file routed *incorrectly* is
worse than one left alone** — it can bury a bookkeeping record where it
won't be found. So the rule throughout is: when a subagent is confident, it
proposes; when it is not, it leaves the file alone and says why.

**No review record.** The accounting profile documents no record backend
(its `profile.md`'s "Record backend" section): a routed file physically
leaves the root, so there is nothing to remember. This skill never hashes a
file, never looks one up, and never records a verdict.

## Architecture at a glance

```
Orchestrator (this file)
 ├─ Step 0  model gate — refuse to run above Sonnet (honour system)
 ├─ Step 1  find the folder to review; resolve its filing profile + Kind via
 │            /file-sorting; refuse any Kind but route-to-destination
 ├─ Step 2  decide what's in scope, per the profile
 ├─ Step 3  location gate (3a, non-recursive listing, no file opened)
 │            → cap at 50 (3c) → ONE subagent per 15-file BATCH, in
 │            PARALLEL (3d), each with the routing template + ONE reference
 │            (routing-rules.md); all subagents get a read-only toolset —
 │            they propose, never move
 ├─ Step 4  aggregate every subagent's structured return; write route-plan.json
 ├─ Step 5  present the combined plan; get approval
 ├─ Step 6  apply approved changes — apply_routes.py (cross-folder move) —
 │            orchestrator does this, not the subagents
 ├─ Step 6.5 resolve "needs manual review" items one at a time
 └─ Step 7  emit a copy-paste "review and refine" prompt for each type-(2) gap
```

**The run writes its working file** — only `route-plan.json` (Step 4), no
`hashes.json`, since there's no record backend to hash against — in
`ACCOUNTING\AI assisted organization\route-accounting\`, a literal path
(the accounting root is a single fixed folder, nothing to glob). Create the
directory if absent; overwrite the file every run. `route-plan.json` is what
survives a **context compaction**: if context is compacted mid-run, Steps 5
and 6 re-read the vetted plan from disk rather than rebuilding it from
memory — a reconstructed plan is a *different* plan, and Step 6 forbids
applying one. This file is per-run working state, **not** a review record.

## Step 0 — Model gate: this skill does not run above Sonnet

This gate is an honour-system refusal. Nothing outside this text enforces
it: it holds only because you name your own model and refuse when that
model is above Sonnet.

**Before anything else, name the model you are running as.** Your system prompt
states it.

- **Sonnet or Haiku** — proceed to Step 1.
- **Opus, Fable, or anything above Sonnet** — **STOP. Run no step.** Tell the
  user, in your own words: accounting routing is high-volume, low-judgment
  file review — reading the face of a lot of bookkeeping documents to decide
  which destination folder each belongs in — and it never needs a model
  above Sonnet. Running it here burns tokens for no better result. Ask them
  to switch with `/model sonnet` and run `/route-accounting` again.

Do not offer to proceed anyway, do not offer a reduced-scope run, and do not
route around the gate by delegating the whole job to a Sonnet subagent. The
user asked for this refusal deliberately; honour it. If you genuinely cannot
determine which model you are, say so and stop — do not guess in favour of
running.

## Arguments

| Argument | Effect |
|---|---|
| a folder path | the folder to review (Step 1) |

## Step 1 — Find the folder to review

**If you're already inside a folder** — invoke `/file-sorting`'s
**detect-profile** intent on the connected folder. If it matches a known
profile, just use it, and record its **Kind** (returned alongside the name)
for the rest of the run. The structure is the signal; don't stop to ask.

**If the connected folder doesn't match any known profile** — ask which
folder to review, and offer a picker rather than asking for a typed path:
call `mcp__cowork__request_cowork_directory` with no `path` argument. Once a
folder is supplied, re-run **detect-profile** against it. If it still matches
nothing, say so and ask the user how to proceed — do not guess a profile.

**If a folder path was supplied as a command argument** — run
**detect-profile** against that folder.

**Refuse any Kind but `route-to-destination`.** If the resolved profile's
Kind is anything else, run no further step and reply with this one line:
"That folder is not the accounting root; use `/housekeeping` for it."

## Step 2 — Decide what's in scope

Invoke `/file-sorting`'s **scope** intent for this root and its resolved
profile, and follow all of what it returns exactly: the in-scope location
(files loose directly at the root, non-recursive), the never-descend list,
and the routing-rule table (destination folder + destination-subfolder rule
per rule, in priority order, plus which rules require opening a file's
content) and the extension whitelist. (For `accounting`, see
`../file-sorting/profiles/accounting/profile.md`.) There is no folder-type
table and no per-subfolder dispatch to plan here — scope is one flat list
of loose root files.

If a destination has no matching content, simply don't dispatch a subagent
for it. Never invent folders.

## Step 3 — Gate, cap, then dispatch (in parallel)

### 3a. Location gate — no subagent, no file opened

There is no naming grammar to check for this Kind, and no alternate
whole-name formats to reconcile against. The question this gate answers is
purely **"is this file still loose at the root?"**, never "is this filename
well-formed" — a routed file's name never changes, so name conformance is
out of scope here by design.

List every whitelisted-extension file sitting **directly at the profile
root**, per Step 2's scope — a plain, non-recursive listing, filtered by the
extension whitelist and the never-descend list. This is the entire gate: no
script is needed (there is no grammar to run `/file-naming`'s **gate**
intent against), and **which of the profile's routing rules a file matches
is deliberately not decided here** — some rules need a file's content read
(`accounting`: rules 4 and 6), so rule-matching belongs to the dispatched
subagent (3d), not a mechanical pre-filter that would have to guess at
content it can't see.

The whole surviving list is this profile's work list — proceed straight to
3c. There is no record gate: there is no record backend to look anything up
against.

### 3c. Cap the work list at 50 files

**Review at most 50 files per run.** Sort everything surviving the location
gate by filename, and take the first 50. Everything past 50 is **deferred**:
not dispatched, not opened, and untouched on disk. A run always advances on
its own, because a routed file physically leaves the root and can't draw the
same 50 files twice, so the next run reaches the deferred files. The sort is
what makes "the next 50" mean the same thing on the next run.

The cap exists for the approval gate, not for cost. A gate presenting a hundred
proposed routes is not one a person reads, and an unread gate on live
bookkeeping files is the failure this skill most needs to avoid. Fifty is a
plan a practitioner can actually check.

### 3d. Dispatch

There is no folder-type table for this Kind — the capped work list (3a +
3c) is one flat list of loose root files. **Split it into batches of up to
15 files** (so a full 50-file cap dispatches at most 4 subagents) and
dispatch one subagent per batch using the **Agent tool**, dispatched with
`subagent_type: "file-manager:housekeeping-reviewer"` and **pinned to
`model: "sonnet"`**. Issue all the dispatches **in a single turn** so they
run concurrently — one batch's review never blocks another's. If that agent
type is absent from this session's roster, dispatch the generic agent
instead with the same prompt — the template's restrictions then carry the
read-only rule alone. If the work list is empty, dispatch nothing and skip
to Step 4 with an empty result set.

Build each subagent's prompt from
`subagents/subagent-prompt-template-routing.md`, filling in:

- **the batch's explicit work list** — absolute paths, this batch only;
- **the run date** — rule 6's 30-day-age test is computed against this, not
  against any file's own date;
- **the four destination-root paths**, verbatim, as recorded from Step 2;
- **the one reference file**: `../file-sorting/profiles/accounting/notes/routing-rules.md`
  (absolute path);
- the **structured return contract** (reproduced in the routing template) it
  must hand back.

**Restricted toolset.** The `file-manager:housekeeping-reviewer` agent
definition enforces this structurally — its toolset has no `Edit`, `Write`,
or any rename/move capability, so a subagent dispatched under that type
cannot mutate the filesystem regardless of what its prompt says. `Read` is
available for opening a file's content (needed for routing rules 4 and 6).
Its `Bash` is prompt-scoped to reading: listing the folder, reading file
bytes, and the SwitchYard plugin's `environment-gauge` skill for stubborn
`.docx` files. If the fallback to the generic agent above is used instead,
the toolset must be built the same way and the read-only restriction is then
carried by the prompt alone. The subagents *propose*; the orchestrator
*applies*, after the user signs off (Step 6).

Each subagent, within its batch, will:

1. Take its explicit work list as its scope — the orchestrator already ran
   the location gate (3a), so it does not re-list the root.
2. For each file, check it against the routing rules in priority order
   (first match wins). Propose a destination **without opening the file**
   only when both the matched rule and its full destination path are
   unambiguous from the filename alone; otherwise open it under the PDF page
   budget in the routing template — always for rule 6, always for a rule-4
   candidate, whenever the filename lacks a date the destination depends
   on. A file matching no rule, or one whose destination can't be confirmed
   within budget, goes on "needs manual review" instead.
3. Keep an **escape log** (see Step 4) every time it has to step outside
   `routing-rules.md`.

## Step 4 — Aggregate the subagents' returns

Each subagent returns the routing template's structure. Collect all of them:

- **Proposed routes** — `current name → matched rule → destination folder →
  destination subfolder → one-line rationale`.
- **Needs manual review** — files that matched no rule, or whose destination
  couldn't be confirmed within budget, each with a short reason.
- **Deferred** — held by you from the Step 3c cap: files that fell past 50.
- **Escape log** — every moment the subagent stepped outside
  `routing-rules.md` (reached a case it doesn't address, or would have
  needed to ask the user), **each tagged with a classification**:
  - **(1) One-off anomaly** — a corrupted file, an obviously non-bookkeeping
    file that slipped past the extension filter, or similar. Falling back
    was the *correct* move. **No action, nothing carried forward.**
  - **(2) Instruction gap** — something `routing-rules.md` (or `profile.md`
    for a scope/detection gap) should have covered but didn't (a document
    type or vendor pattern with no rule, an ambiguous rule, a missing
    example). Carried forward to Step 7.

  Each (2) entry must arrive with three pieces — **triggering file**, **what
  `routing-rules.md` currently says**, and **what was missing**. Those three
  pieces are exactly the raw material Step 7 turns into a refine-prompt, so
  don't accept a (2) entry that's missing any of them — send it back to the
  subagent or downgrade it to manual review.

**Reconcile:** two identities must hold — per batch, routes + manual-review
= that batch's work list; overall, work list + deferred = the full in-scope
loose-file listing from the location gate (3a). There is no "conforming" or
"already-reviewed" count for this Kind (no name gate, no record gate).

While reconciling, **downgrade to manual review any proposed route whose
destination folder does not lie under one of the four destination roots, or
that names no matched rule.** Every proposal must land under a real
destination. `apply_routes.py`'s preflight rejects these too (a `dst_dir`
outside every `allowed_dst_root`), but only after the user has already
approved them — catch it here first.

**Write the plan to disk before Step 5.** Once the identities hold, save the
whole aggregated plan to `route-plan.json` (see "The run writes its working
file" above):

```json
{
  "created": "YYYY-MM-DD",
  "accounting_root": "<absolute path>",
  "destination_roots": ["<absolute path>", "..."],
  "routes": [ { "current": "", "current_path": "", "matched_rule": "", "destination_folder": "", "rationale": "" } ],
  "manual_review": [ { "current": "", "current_path": "", "reason": "" } ],
  "deferred": [ { "current": "" } ]
}
```

No `hash` field anywhere — this profile has no record backend and never
hashes a file. No destination-*filename* field — a routed file's name never
changes except for an apply-time collision suffix, which `apply_routes.py`
decides, not this plan.

## Step 5 — Present the combined plan and get approval

Present the plan as **chat text** and get approval with one plain-text
question ending the turn, per `/show-me`. Apply **nothing** yet.

Read the plan back from `route-plan.json` rather than from memory — after a
compaction that file is the only vetted copy.

1. **Show the proposed changes**, grouped by destination folder, as markdown
   tables: `current → destination subfolder`, plus the matched rule and
   one-line rationale, grouped under a `Destination folder` heading per
   group.
2. **Show the needs-manual-review items** under their own heading, each with
   the reason it couldn't be confidently routed.
3. **State the totals explicitly**: "N proposed routes, M manual-review
   items". N is the number the user is approving, and Step 6 checks the
   applied set against it. **When the Step 3c cap deferred anything, say so
   in the same breath** — "…and D files this run did not look at; re-run
   `/route-accounting` to work the next 50." A user who isn't told the run
   stopped early will read the folder as finished.
4. **Seek approval for the proposed changes** as the last line of the
   message, in plain text — approve all / approve by destination / hold off.
   Manual-review items are not part
   of this question; they are worked one at a time in the Step 6.5 loop
   afterwards.

Present in plain chat text, never a rendered widget. This is a compliance gate
on live bookkeeping files, and a gate that silently fails to render is a gate
that did not happen.

**The safe default is "leave it alone": anything not explicitly approved is not
routed.** A wrong route can bury a bookkeeping record, so when in doubt the
file stays as-is.

## Step 6 — Apply the approved changes

**You** (the orchestrator) perform the moves — the subagents never had write
access. Route **only** the files the user approved.

**Always apply routes through `../file-apply/scripts/apply_routes.py`**
(reached via `/file-apply`'s **apply-route** intent) — never by hand, one
move at a time. Build its JSON manifest from `route-plan.json`, restricted to
the entries the user approved: `src_root` is the accounting root,
`allowed_dst_roots` is the four destination roots recorded in `route-plan.json`,
and each `routes` entry's `dst_dir` is the entry's `destination_folder`. Set
`expected_total` to the count you gave the user at Step 5. Its preflight is
all-or-nothing on count and scope: a count mismatch, a missing source, a
source not directly at the accounting root, or a destination outside every
allowed root moves **nothing** and exits non-zero. **A destination-filename
collision does not fail the batch** — the script appends a numbered suffix
(`name (2).ext`, ...) and moves the rest of the batch regardless; this is the
user-confirmed policy for this Kind. A move that fails mid-run for
another reason (locked file) is reported and skipped, not forced. Missing
leaf destination folders are created by the script itself (`makedirs`) —
nothing to scaffold here first.

**If the set about to be applied differs from what the user approved, apply
nothing.** After a compaction, a replan, or any reconstruction, compare what
you are about to apply against `route-plan.json` and the approved count. If
they diverge, say plainly "the plan changed from N to M, because …",
re-present the changed plan, and get fresh approval before applying anything.
`expected_total` catches a changed *count* mechanically; the callout is
required even when the count is unchanged and the *files* differ, which no
preflight can see.

When done, report what was routed (noting any collision suffix applied) and
what was skipped (and why), so the user has a clean record of the changes.
Repeat the deferred count here if the cap bit, with the same re-run
invitation — the end of the run is where a user decides whether the folder
is done.

## Step 6.5 — Resolve "needs manual review" items one at a time

Manual-review items are settled here, after Step 5's bulk approval and the
Step 6 apply pass.

Work through every unresolved item per `/show-me` — one item per turn, asked
as one plain-text question ending the turn, in the order the subagents
returned them.

For each item:

- State the **current filename** + the **reason it couldn't be
  auto-routed** (matches no routing rule, ambiguous Bill-To, or
  receipt-vs-payable unresolved within budget).
- Offer **the destination options that plausibly apply** (derive them now
  from the routing rules and what you know of the document), each naming its
  destination folder and subfolder.
- Include an **"Other / leave as-is"** option — this is the expected outcome
  for a genuine no-rule-match file; say so plainly rather than treating it as
  a failure. Leaving it as-is means it stays loose at root and is re-flagged
  on the next run (the accepted tradeoff — see `profile.md`'s Record backend
  section).
- **Apply the chosen route immediately** — before moving to the next item, by
  building a one-item `apply_routes.py` manifest (same `src_root` /
  `allowed_dst_roots` / never-overwrite-suffix rule as the batch apply in
  Step 6). If the user picks "leave as-is," note it and continue — do not
  invent a destination.

Complete every item before proceeding to Step 7. Do **not** batch items into
a single question — one item per turn.

## Step 7 — Emit a "review and refine" prompt for each type-(2) gap

This is what closes the self-improving loop. For **every type-(2) escape-log
entry** gathered in Step 4, hand the user a ready-to-paste prompt they can drop
into a fresh session to fix the gap permanently. Each prompt should:

- name the **reference file to revise** —
  `../file-sorting/profiles/accounting/notes/routing-rules.md` for a
  routing-rule gap, or `../file-sorting/profiles/accounting/profile.md` for a
  scope/detection gap;
- summarise **what happened** — the triggering file, what the reference
  currently says (or that it is silent), and what was missing;
- ask the next session to **add the rule / example** and **show the diff
  before saving**.

Discard every type-(1) entry — those were correct fallbacks and need no
instruction change. If the run produced **no** type-(2) gaps, say so plainly:
the routing rules covered everything this run threw at them, and there is
nothing to refine.
