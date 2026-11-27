---
name: retainer-tracking
disable-model-invocation: true
description: Import trust balance CSV exports, store retainer balances in the practice database, and answer funded/depleted retainer queries. Use when a trust listing CSV is uploaded or mentioned, to check a matter's trust balance, or to ask which files have a depleted or funded retainer.
---

<!-- lawyer v0.34.4 -->
> **Installed copy.** Relative paths below cite this skill's shipped tree.
> Resolve in order: current file's dir, `${CLAUDE_SKILL_DIR}/<path>`, then `${CLAUDE_SKILL_DIR}/../<path>` (so `shared/x.md` is `${CLAUDE_SKILL_DIR}/../shared/x.md`).
> `${CLAUDE_SKILL_DIR}` is this SKILL.md's directory even if unsubstituted: never search or guess.
> Read references and shared files with Read (whole or offset/limit), never via shell, the litigation data server's skill-source tool, or a folder-access request; run declared scripts and templates from there too.
> Before each fresh read (not already in context), list only `${CLAUDE_SKILL_DIR}/../../..`. If it holds this plugin's folder name (sans `~g<N>`)
> plus a `~g<N>` higher than this plugin's folder's own (none counts as 0), or if `${CLAUDE_SKILL_DIR}` no longer exists, the plugin was re-synced mid-session:
> retry the three paths with the highest `~g<N>` copy's `skills/<this skill>` dir and tell the user once that the plugin updated mid-session (old version comment to new SKILL.md comment).
> If still missing at every path, STOP and report the exact path and error: do not substitute, re-derive script logic, search elsewhere, or diagnose further; ask the user to reinstall the plugin and fully restart the app.

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
