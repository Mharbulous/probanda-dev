---
name: retainer-tracking
disable-model-invocation: true
description: Import trust balance CSV exports, store retainer balances in the practice database, and answer funded/depleted retainer queries. Use when a trust listing CSV is uploaded or mentioned, to check a matter's trust balance, or to ask which files have a depleted or funded retainer.
---

<!-- lawyer v0.10.5 -->
> **Installed copy.** This skill's full source tree ships beside this file, and a relative path in the text below cites that tree. Resolve one by trying, in order: the directory of the file you are reading, then `${CLAUDE_SKILL_DIR}/<path>`, then `${CLAUDE_SKILL_DIR}/../<path>` (so `shared/x.md` is at `${CLAUDE_SKILL_DIR}/../shared/x.md`). The host substitutes `${CLAUDE_SKILL_DIR}` with the directory holding this SKILL.md when this file loads; if the literal text `${CLAUDE_SKILL_DIR}` is what you see, that IS the definition: it means the directory containing this SKILL.md, not a placeholder to search for or guess. Read references and shared files natively from there, never over the litigation data server's skill-source tool and never by requesting folder access; scripts and templates the text declares are executed and read from there too. If `${CLAUDE_SKILL_DIR}` itself no longer exists, the plugin was re-synced mid-session: list only `${CLAUDE_SKILL_DIR}/../../..` (the folder that held this plugin's folder), take the folder named as this plugin's folder with any `~g<N>` suffix removed plus the highest `~g<N>`, and repeat the same three tries with its `skills/<this skill>` directory in place of `${CLAUDE_SKILL_DIR}`; tell the user once that the plugin updated mid-session, from the version in this file's version comment to the version in that folder's copy of this SKILL.md. If a file the text names is missing at every one of those paths, including the re-synced folder's, STOP and report the exact path and error to the user rather than substituting an alternative: do not re-derive a script's logic from its source text or the prose, and do not search elsewhere on the filesystem. Ask the user to reinstall the plugin and fully restart the app; this may fix it, but STOP means stop regardless: do not diagnose further yourself.
> **HTML pages.** Every HTML file this plugin writes is a human interface generated from its databases; an agent never views, reads, greps, parses, scripts over, stages, authors or requests a screenshot of one, but may present one to a human user to view, and may view a screenshot the user provides on their own initiative. The rule and the data to use instead: `shared/html-pages.md`.

**Internals stay confidential** (`shared/internals-confidentiality.md`): nothing the practitioner sees names a Probanda tool, table, field, internal type or code, or explains how Probanda works inside. It hides mechanism, never an outcome or an error.

## Contents

| Section | Read when |
|---|---|
| Scope | Deciding whether a request is current retainer status or historical trust accounting |
| Data Source | Mapping CSV columns, or checking the mandatory fields and privacy flag |
| Database | Before any read or write of retainer data |
| Import Workflow | A trust listing CSV is provided |
| Queries | Asked for a matter's balance, funded or depleted matters, or total trust held |
| Integration with Other Skills | Checking which skills consume the retainer data |
| Anti-Patterns | Always, before reading or presenting trust balances |

# Retainer Tracker

Infrastructure skill that owns the retainer data layer. Ingests trust listing CSV exports from the user's accounting system, normalizes trust data, and stores current retainer balances in the practice database via ``practice-data``. Downstream skills consume this data — none maintain their own copy.

## Scope

This skill tracks *current status only*. Historical trust ledgers, past transactions, reconciliation, and full trust accounting belong elsewhere. 

## Data Source

This skill caches retainer data in the practice database for quick access. The source of truth is the user's accounting system — the database is a working copy updated on each import.

Mandatory data fields for this skill:
| clientID | matterID | responsibleLawyer | TrustBalance | LastTrustDate |

Optional additional fields are determined by the user's accounting system. CSV column mappings and system-specific details are stored in `probanda.json` under `accounting.csv_mapping` (see `practice-data/SKILL.md` for the full schema).

For UNITY® Accounting (by Dye & Durham, formerly esilaw) — the most common accounting system for this skill — read `reference/UnityAccounting.md` for column names, sign convention, date format, and export instructions before mapping or importing.

### Privacy

The `exclude_client_names` flag in `probanda.json` controls whether client names are stored. When `true`, no client name is stored for any record and the import skips the name column entirely. This is set during the First Import Protocol and can be changed by the user at any time.


## Database

All practice-database access — reads, writes, and configuration — is owned by `practice-data`. This skill never touches the database directly. See `..`practice-data`/SKILL.md`.

## Import Workflow

When the user provides a trust listing CSV:

1. Check `probanda.json` for `accounting.system` and `accounting.csv_mapping` (path resolution and config live in ``practice-data``).
2. **If either is missing:** run the First Import Protocol at `protocols/FirstImport.md` — this handles accounting system identification, privacy briefing, column mapping, and optional export research. After the protocol completes, continue from step 3 below.
3. Load system-specific CSV mapping from `accounting.csv_mapping` in `probanda.json` — this defines column names, date format, sign convention, and any quirks for that accounting system.
4. If `accounting.exclude_client_names` is `true` in `probanda.json`, skip the client name column and store no client name.
5. Parse the CSV with Python's `csv` module. Build one normalized row per line:
   - client number and matter number — the mapped client and matter values
   - client name and responsible lawyer — mapped values (omit the client name when `exclude_client_names` is set)
   - trust balance — the mapped balance, keeping the accounting system's sign convention (funded is negative, never positive)
   - last trust date — the trust date parsed to ISO 8601 (via `accounting.csv_mapping.date_format`), or `null` for missing/sentinel dates
6. **Stale-data guard:** fetch the stored last trust date for existing matters via ``practice-data`` `trust-summary` (all matters), and drop any row whose CSV last trust date is not strictly newer than the stored value (a matter absent from the DB is always imported).
7. Hand each surviving normalized row to ``practice-data`` `upsert-client-matter` (keyed on client number and matter number). It upserts the client and matter and records the trust balance and date.
8. Report: imported count, skipped (stale), depleted (zero balance).

## Queries

All queries executed via ``practice-data`` `trust-summary` operation.

| Question | Operation |
|----------|-----------|
| Balance for a specific matter | `trust-summary` filtered to one matter |
| All funded matters | `trust-summary` filtered to funded |
| Depleted matters (balance = 0) | `trust-summary` filtered to depleted |
| Total trust held | `trust-summary` for all funded matters, summed |

Note: Sign convention varies by accounting system (stored in the practice config). Trust balances are presented as positive numbers to the user.

## Integration with Other Skills
- **Task Prioritization** reads the trust balance to rank tasks by the retainer-first model
- **Billing Summary** uses the trust balance to calculate remaining retainer vs. WIP
- **AR Follow-Up** identifies matters needing retainer replenishment requests



## Anti-Patterns
- **Downstream skill parsing an accounting CSV directly** instead of reading from the practice database via ``practice-data``. All trust data enters through this skill's import workflow.
- **Treating absence as zero balance.** No row = unknown status. A stored balance of zero = depleted retainer.
- **Displaying raw negative trust values to the user.** Always show the absolute value of the trust balance.
