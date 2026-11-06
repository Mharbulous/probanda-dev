---
name: vet-billable-time
description: "Use when /bill-client reaches its time work, or the practitioner asks to vet a matter's billable time: confirms each TimeCamp line's duration and client-readable description against its evidence, one line at a time, proposes estimates for documented work with no entry and write-offs for non-billable windows, ties the result to TimeCamp, records the time entries, and writes the billable time summary and audit file beside the coming invoice. Never changes TimeCamp (/timecamping does). Does not render the invoice (/bill-client)."
dependencies:
  - timecamping-data  # the determinations each line joins to
  - show-me           # every line presented for the practitioner's decision
---

<!-- timekeeper v0.8.8 -->
> **Installed copy.** This skill's full source tree ships beside this file, and a relative path in the text below cites that tree. Resolve one by trying, in order: the directory of the file you are reading, then `${CLAUDE_SKILL_DIR}/<path>`, then `${CLAUDE_SKILL_DIR}/../<path>` (so `shared/x.md` is at `${CLAUDE_SKILL_DIR}/../shared/x.md`). `${CLAUDE_SKILL_DIR}` is the directory holding this SKILL.md, even where it shows unsubstituted: never search for it or guess. Read references and shared files from there with the Read tool, a whole file or an offset and limit, never with a shell command, the litigation data server's skill-source tool or a folder-access request; scripts and templates the text declares are executed and read from there too. Before each fresh read (a file not already in context), list only `${CLAUDE_SKILL_DIR}/../../..` (the folder holding this plugin's folder). If it holds this plugin's folder name, with any `~g<N>` suffix removed, plus a `~g<N>` higher than this plugin's folder's own (none counts as 0), or if `${CLAUDE_SKILL_DIR}` no longer exists, the plugin was re-synced mid-session: take the highest `~g<N>` copy and repeat the same three tries with its `skills/<this skill>` directory in place of `${CLAUDE_SKILL_DIR}`; tell the user once that the plugin updated mid-session, from the version in this file's version comment to the version in that folder's copy of this SKILL.md. If a file the text names is missing at every one of those paths, including the re-synced folder's, STOP and report the exact path and error to the user rather than substituting an alternative: do not re-derive a script's logic from its source text or the prose, and do not search elsewhere on the filesystem. Ask the user to reinstall the plugin and fully restart the app; this may fix it, but STOP means stop regardless: do not diagnose further yourself.
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

3. **Join each entry to its proposal,** with `/timecamping-data`'s billing read over the same dates. An entry no live proposal names is flagged "no evidence". That includes every staff entry, because `/timecamping` judges only the practitioner's own time. A proposal committed silently has no determination but does have evidence, so it is not flagged. A proposal's evidence rows come from its evidence chain, each read by `/timecamping-data`'s single-row detail read, and each copied to `vetted.json` as metadata only: never a body, document text, OCR or raw payload.

   **Non-billable windows, on every run, before any line is shown.** Read the markers from `/timecamping-data`'s evidence store. If there are any, call `activities` with `entry_ids` the matter's entries and `out_file`, at most 20 dates a call, and run `timecamping-data/scripts/scan_windows.py markers` over those files. This covers dates `/timecamping` did not judge and staff entries. Its matches are proposals for step 5, never deductions.

4. **Rates, initials and firm rules.** Call `practice_data__rates_query`. For anyone with no rate there, read the rate from the retainer PDF in `2. SOLICITOR CLIENT`: call `pdf_pages__images` first, then read a `scanned` page only from its PNGs and a `born_digital` page with `Read` `pages:`. If none is found, ask once. Save each with `practice_data__upsert_rate`, with its effective date and source document, and show the rates once. Each person's `rate_source` in `vetted.json` names that document. Initials come from `practice_data__firm_profile`; ask once for anyone not on its roster. Its `billing_settings` give the increment and minimum, which default to 0.1 h each. Ask once for whether clerical staff work is billed if unset, and save the answer with `practice_data__upsert_firm_profile`. Run `scripts/blank_staff_notes.py` with the names it marks staff, and show any list once, so the practitioner can ask them to add a short TimeCamp note.

5. **Vet each line, one at a time, under `/show-me`:** date, person, start, end, unrounded hours, the proposed description, and the evidence (entry id, source rows). The practitioner confirms, corrects or writes it off, and each answer applies to that line alone. Save each answer to `vetted.json` in the working folder before showing the next line, so a long run survives compaction: on re-entry, start from the first line it does not hold.
   - Write the description in bill style from the first showing: present-tense verb phrases a client can read, joined by semicolons, naming no app or window. "Telephone call with client; review draft affidavit; correspondence with opposing counsel". "Draft notice of application; review court file". `tie_out.py` joins a person's day as written, so capitalize only the day's first phrase. State only what the evidence shows, never a guessed purpose, save the inference below. A call's evidence names its direction, duration and outcome.
   - Show the span the evidence supports, in seconds: a call's length, a document's edit span, a screen block, counting overlapping evidence once. Where the evidence cannot bound the duration, show "unbounded" and ask for the practitioner's figure, which is recorded as their estimate.
   - A staff line with no activity is described from its note. With no note, infer it from surrounding events: the lawyer's time on the matter ending just before it, documents saved shortly before or during it, or no file changing during it (moves and renames keep the modified time). Mark that description "Inferred" with one line naming those events, and keep the line in `confirmed` once confirmed.
   - A "no evidence" line bills only if the practitioner confirms it and gives an estimate. The summary lists it apart.
   - A marker's match inside the entry shows as a proposed write-off, with its pattern, windows and matched seconds. The practitioner decides for that entry. Only on a yes, add it to the line's `excluded` with their words; on a no, nothing comes off. If they rule a new pattern non-billable, save it as a marker.
   - A staff line stays labelled as staff time and is never presented as the lawyer's work.

6. **Flags from the candidate list:**
   - An under-billed billed date or a suspicious date gets one question: bill it as a late line dated the work date, or write it off. The default is write-off when the last bill is over three months old. For a late line, pull that date with `entries` into its own working file, and vet it like any other line.
   - A Strong or Medium date with no TimeCamp time, and each block `/timecamping` lists as possible unbilled time, gets a proposed estimate from the evidence that put it there: labelled as an estimate, with the rows it rests on, the minutes, the method and the reason. The candidate list is not proof of time, so the estimate cites evidence rows, never the list. Under `/show-me`, the practitioner approves it, corrects it, writes it off, or enters the time by hand, which means pulling again from step 1. Save an approved one to `vetted.json`'s `estimates`, and through `/timecamping-data`'s evidence store. Where the evidence gives no basis and the practitioner gives none, the date stays "unexplained".
   - A call from `phone-matches.json` off the matter's task or with no entry is proposed the same way, with the call's seconds.
   - Unexplored leads and failed sources go to the gaps list unchanged.

7. **Finish `vetted.json`,** in the shape `tie_out.py`'s docstring gives: each answer exactly as given, with no figure but the supported spans, estimates, exclusions and rates. Write the source log's rows for the billed dates to `coverage.json` with `/timecamping-data`'s coverage read.

8. **Run the final tie-out:** `tie_out.py final` with `--date` today, `--coverage` that file, `--run-started` when this bill's time work began, and the firm's increment and minimum in seconds if set. On a pass it writes `YYYY-MM-DD Billable time audit.md` and `YYYY-MM-DD Billable time summary.md` to `BILLING`, rewritten in place, and `invoice_lines.json`, `line_map.json` and `time_entries.json` to the working folder. A line changed after a pass means running it again.

9. **Record the time entries:** `practice_data__upsert_time_entries` with the matter and `entries_file` that `time_entries.json`. Running it again updates them and adds none. Report any it names as already locked.

Return to the caller the two reports' paths, the path of `invoice_lines.json`, and the fees and hours the script printed.
