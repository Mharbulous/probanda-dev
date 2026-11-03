---
name: vet-billable-time
description: "Use when /bill-client reaches its time work, or the practitioner asks to vet a matter's billable time: confirms each TimeCamp line's duration and client-readable description against its evidence, one line at a time, ties the result to TimeCamp, and writes the billable time summary and audit file beside the coming invoice. Never changes TimeCamp (/timecamping does). Does not render the invoice (/bill-client)."
dependencies:
  - timecamping-data  # the determinations each line joins to
  - show-me           # every line presented for the practitioner's decision
---

<!-- timekeeper v0.4.3 -->
> **Installed copy.** This skill's full source tree ships beside this file, and a relative path in the text below cites that tree. Resolve one by trying, in order: the directory of the file you are reading, then `${CLAUDE_SKILL_DIR}/<path>`, then `${CLAUDE_SKILL_DIR}/../<path>` (so `shared/x.md` is at `${CLAUDE_SKILL_DIR}/../shared/x.md`). The host substitutes `${CLAUDE_SKILL_DIR}` with the directory holding this SKILL.md when this file loads; if the literal text `${CLAUDE_SKILL_DIR}` is what you see, that IS the definition: it means the directory containing this SKILL.md, not a placeholder to search for or guess. Read references and shared files natively from there, never over the litigation data server's skill-source tool and never by requesting folder access; scripts and templates the text declares are executed and read from there too. Before each fresh read (a file not already in context), list only `${CLAUDE_SKILL_DIR}/../../..` (the folder holding this plugin's folder). If it holds this plugin's folder name, with any `~g<N>` suffix removed, plus a `~g<N>` higher than this plugin's folder's own (none counts as 0), or if `${CLAUDE_SKILL_DIR}` no longer exists, the plugin was re-synced mid-session: take the highest `~g<N>` copy and repeat the same three tries with its `skills/<this skill>` directory in place of `${CLAUDE_SKILL_DIR}`; tell the user once that the plugin updated mid-session, from the version in this file's version comment to the version in that folder's copy of this SKILL.md. If a file the text names is missing at every one of those paths, including the re-synced folder's, STOP and report the exact path and error to the user rather than substituting an alternative: do not re-derive a script's logic from its source text or the prose, and do not search elsewhere on the filesystem. Ask the user to reinstall the plugin and fully restart the app; this may fix it, but STOP means stop regardless: do not diagnose further yourself.
> **HTML pages.** Every HTML file this plugin writes is a human interface generated from its databases; an agent never views, reads, greps, parses, scripts over, authors or requests a screenshot of one, but may present one to a human user to view, staging it first where presenting needs that, and may view a screenshot the user provides on their own initiative. The rule and the data to use instead: `shared/html-pages.md`.

**Internals stay confidential** (`shared/internals-confidentiality.md`): nothing the practitioner sees names a Probanda tool, table, field, internal type or code, or explains how Probanda works inside. It hides mechanism, never an outcome or an error.

This skill deliberately carries no `disable-model-invocation` line: `/bill-client` opens it through the Skill tool, which refuses a skill carrying that line. It is a stated exception. Do not add the line back.

# /vet-billable-time

Turn a matter's TimeCamp entries since the last bill into lines the practitioner has confirmed, each tied to its evidence.

`scripts/tie_out.py` does all the billing arithmetic and every check. Never add, round or write off time yourself, and never state a total it did not print. Its docstring is the contract for its inputs. Run it with the host Python (`python`; if that is the WindowsApps stub, the interpreter `COCLERK_PYTHON` names). A failing check stops this skill: tell the practitioner what failed, in plain words, and fix the input only with their answer.

**Inputs:** the matter, its candidate-dates file, the last billed date, the retainer PDF, and the judged dates file `/timecamping` keeps at `<matter-data folder>\timecamping\judged-dates.jsonl`.

Working files go in `<matter-data folder>\vet-billable-time\`, and the two reports in the matter's draft folder's `BILLING` subfolder, resolved as `shared/workspace-output-rule.md` says. Create only the `BILLING` leaf if it is absent.

Connector tools are named without their prefix. Call each under whichever of `mcp__plugin_timekeeper_timecamp__<name>` and `mcp__remote-devices__plugin_timekeeper_timecamp__<name>` this host grants. This skill never calls `update_entry`: a change of matter or note goes back to `/timecamping`.

## Steps

1. **Pull the entries.** Call `status`. On `usable: false`, stop and give its `reason`. Never open the TimeCamp web app. Call `tasks` with `query` set to the matter number: exactly one active match must be the matter (its `path` names the matter number); otherwise stop and show the matches. Call `entries` with `from` the day after the last billed date, `to` today, `task_ids` the matter's task, `billable: true`, no `user_ids`, and `out_file` a working file. Note its `count` and `totals.hours`.

2. **Run the first tie-out:** `tie_out.py pull`. A date it names as unjudged goes back to `/timecamping`.

3. **Join each entry to its determination,** with `/timecamping-data`'s billing read over the same dates. An entry with no determination is flagged "no evidence". That includes every staff entry, because `/timecamping` judges only the practitioner's own time. A determination's evidence rows come from its evidence chain, each read by `/timecamping-data`'s single-row detail read.

4. **Rates and initials.** Read the rates from the retainer PDF in `2. SOLICITOR CLIENT`: call `pdf_pages__images` first, then read a `scanned` page only from its PNGs and a `born_digital` page with `Read` `pages:`. Show them once. If none is found, ask once. Initials come from `practice_data__firm_profile`; ask once for anyone not on its roster.

5. **Vet each line, one at a time, under `/show-me`:** date, person, start, end, unrounded hours, the proposed description, and the evidence (entry id, source rows). The practitioner confirms, corrects or writes it off, and each answer applies to that line alone. Save each answer to `vetted.json` in the working folder before showing the next line, so a long run survives compaction: on re-entry, start from the first line it does not hold.
   - The description states only what the evidence shows: "Phone call to client, 12 min", "Drafting retainer letter". Never a guessed purpose.
   - Show the span the evidence supports, in seconds: a call's length, a document's edit span, a screen block, counting overlapping evidence once. Where the evidence cannot bound the duration, show "unbounded" and ask for the practitioner's figure, which is recorded as their estimate.
   - A "no evidence" line bills only if the practitioner confirms it and gives an estimate. The summary lists it apart.

6. **Flags from the candidate list:**
   - An under-billed billed date or a suspicious date gets one question: bill it as a late line dated the work date, or write it off. The default is write-off when the last bill is over three months old. For a late line, pull that date with `entries` into its own working file, and vet it like any other line.
   - A Strong or Medium date with no TimeCamp time is "unexplained" until the practitioner gives a reason or enters time by hand. Entered time means pulling again from step 1.
   - Unexplored leads and failed sources go to the gaps list unchanged.

7. **Finish `vetted.json`,** in the shape `tie_out.py`'s docstring gives: each answer exactly as given, with no figure but the supported spans, estimates and rates.

8. **Run the final tie-out:** `tie_out.py final` with `--date` today. On a pass it writes `YYYY-MM-DD Billable time audit.md` and `YYYY-MM-DD Billable time summary.md` to `BILLING`, rewritten in place, and `invoice_lines.json` to the working folder. A line changed after a pass means running it again.

Return to the caller the two reports' paths, the path of `invoice_lines.json`, and the fees and hours the script printed.
