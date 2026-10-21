# First Import Protocol

Run this protocol the first time a user imports trust data from their accounting system. This covers one-time setup steps that do not repeat on subsequent imports.

**Trigger:** The user provides a trust listing CSV and either `accounting.system` is absent from `probanda.json`, or `accounting.csv_mapping` is absent.

## Step 1 — Identify the Accounting System

If `accounting.system` is not yet set in `probanda.json`:

1. Examine the CSV filename and headers for clues (e.g. "TrustListing" is characteristic of UNITY® Accounting by Dye & Durham)
2. Check whether a reference file already exists at `reference/[SystemName].md` — if so, read it before drawing any conclusions about the software
3. Ask the user to confirm: *"This looks like an export from [system]. Is that right, and is that the correct spelling?"*
4. Save the confirmed name to `accounting.system` in `probanda.json`

If `accounting.system` is already set, skip to Step 2.

**Important:** Do not make confident factual claims about who makes the software or its official status unless you have read a reference file that confirms them. Accounting software vendors and product names are easy to confuse. If in doubt, describe what you observe from the CSV (filename pattern, column names) and let the user confirm.

## Step 2 — Privacy and Data Storage Briefing

If `exclude_client_names` is already set in `probanda.json`, skip to Step 3. Otherwise, brief the user: the practice database can either store client names alongside matter numbers, or omit them entirely (storing no client name). Ask which they prefer, and write the answer to `accounting.exclude_client_names` in `probanda.json` (`true` = omit names). The user can change this at any later import.

## Step 3 — Column Mapping

1. If a reference file exists for this accounting system (e.g. `reference/UnityAccounting.md`), read it — it contains the known column names, sign convention, and date format, and can pre-fill the mapping with high confidence
2. Read the CSV headers
3. Match headers against the mandatory fields: `clientID`, `matterID`, `clientNames`, `responsibleLawyer`, `TrustBalance`, `lastUpdated`
4. Present the proposed mapping to the user for confirmation — even when the reference file matches perfectly, a brief confirmation keeps the user informed
5. Also identify any additional columns present (e.g. `Orig Law`, `Type of Law`, `Major Client`, `Term Trust`) and note them as optional fields that will be imported if available
6. Once confirmed, save the full mapping to `accounting.csv_mapping` in `probanda.json`, including:
   - `csv_report_name` — the report name (from the filename pattern)
   - `date_format` — the date format used in the CSV
   - `sign_convention` — how trust balances are represented (e.g. `negative_is_funded`)
   - `column_map` — the confirmed column-to-field mapping
   - `quirks` — any system-specific parsing notes discovered during mapping

## Step 4 — Offer Export Research (only if no reference file exists)

If `reference/[SystemName].md` does not already exist, offer to research the accounting system's export capabilities after the column mapping is confirmed:

*"Would you like me to do some quick research on [system]'s export options? I can look into what report formats are available, how to run trust listing exports, and any tips for getting the cleanest data out. This runs in the background and won't slow down the import."*

If the user approves:

1. Spawn a **background research subagent** with a prompt like:

   > Research [accounting system name] — who makes it, what kind of software it is, and how to export trust balance / trust listing reports from it. Cover: the software vendor and product description, available export formats (CSV, XLS, PDF, etc.), how to run the export (menu paths or steps), any known quirks or limitations with the export, and the official spelling/capitalization of the product name. Focus on factual, verifiable information. Summarize findings concisely.

2. While the subagent runs, proceed immediately to Step 5 (do not wait)
3. When the subagent returns, review its findings critically — research agents can sometimes confuse similar products or invent vendor details. Cross-check any vendor/product claims against what the user has confirmed
4. Save the vetted findings to `reference/[SystemName].md` for future sessions
5. If the research reveals the accounting system name is spelled differently than what's stored in `probanda.json`, flag this to the user and update `probanda.json` if they confirm

## Step 5 — Run the Import

Hand off to the standard Import Workflow in `SKILL.md` (starting at step 5: "Parse the CSV with Python's `csv` module"). The column mapping and system configuration are now in place.

After the import completes, report the standard summary: imported count, skipped (stale), depleted (zero balance).

## What Does NOT Happen on Subsequent Imports

On future imports, the following are already configured and will be read from `probanda.json` without user interaction:

- Accounting system name
- Column mapping
- Sign convention and date format
- Privacy preferences (client name exclusion)

The standard Import Workflow in `SKILL.md` handles subsequent imports directly. This protocol is only invoked when one or more of those configuration values are missing.
