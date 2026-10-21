---
status: accepted
date: 2026-10-21
---

# A matter's case data lives in its own `0. CASE DATA` folder inside the matter folder

Each matter's case data (`main.sqlite`, `law.sqlite`, `privileged.sqlite`, `submission.sqlite`, `evidence.sql`, `mockups\`, `housekeeping\`, `form-sessions\` and the other workflow folders) lived in a firm-level `<library>\0. CASE DATA\<matter_id> <short_name>\`, beside the matter folders. From now on it lives in `<matter folder>\0. CASE DATA\`, flat, with no per-matter subfolder. The pointer (`probanda.json`, and `coclerk.json` with the same content) stores it as the relative value `0. CASE DATA`, and `evidence_sql_path` as `0. CASE DATA\evidence.sql`.

The firm-level `<library>\0. CASE DATA\` stays as `case_data_root`. It holds the practice stores only: `_practice\practice.db`, the knowledge overlay, timecamping and preferences.

## Why

The firm-level location was chosen to keep the binaries clear of the Cowork FUSE mount-staleness bug (Coclerk ADRs 0008 and 0012). The evidence no longer supports that reason:

- **The location never protected against the bug.** The 2026-07-11 investigation (finding F1) found that the firm-level folder is inside the same synced library, so it shares the exposure. What protects the binaries is temp-copy staging, the `DELETE` journal and copy-back.
- **Sessions reach files only through host tools.** Since 2026-09-12 a session reads and writes case data only through the host-side MCP tools (Coclerk research 2026-10-02). A Cowork session never opens these files from the sandbox mount, wherever they sit.
- **The split now costs a second folder grant, and it failed.** On 2026-10-21 `device_request_folder_access` refused the firm-level case-data path, and `device_stage_files` refused a file outside the connected matter folder, so a matter's database could not be shown. Inside the matter folder, the matter's own grant covers its case data.

## Decisions

- **New matters** default to `<matter folder>\0. CASE DATA\`. `/matter-data initialize` writes the relative pointer value, and the first `matter_data__execute` creates the folder.
- **The resolver's order** (both copies: `resolve_paths.py` and the backend's embedded helper): a stored nominee holding `main.sqlite`, then the matter's own `0. CASE DATA` holding `main.sqlite`, then a not-yet-relocated folder under the firm root (by matter id, then by the old derived name), then the matter's own folder as the default. The pointer write-back stores the folder relative to the matter folder when it is inside it, absolute otherwise.
- **Existing matters keep working unchanged** until the practitioner runs `matter_data__relocate` (`/matter-data` `operations/relocate.md`). It copies the old folder to a staging folder inside the matter, checks every file's sha256 and, for each `.sqlite`, `integrity_check`, per-table row counts and `user_version`, then renames the staging folder and rewrites both pointer files, after copying each aside. It deletes nothing. On any failure the pointer files are byte-identical and the staging folder stays.
- **Commandment 7.** Relocation only copies files and writes Probanda's own pointer. It moves, renames or deletes nothing Probanda did not create, so it is not a file-manager operation.
- **The firm-root fallbacks** that assumed the sibling layout accept both. `caseDataRootFromCaseDataDir` takes the `0. CASE DATA` beside the matter folder when the matter-data folder is the matter's own. The contact checks' no-matter scan looks in each matter folder's `0. CASE DATA` first, then under the firm root.

## What stays

- **The FUSE workaround code is retained** until the bug is confirmed gone for every session shape: inline mockup markdown in `drafting_forms__render`'s response, temp-copy staging, `fuse_safe_io.py` and the Write-tool rules. Only the location and its stated reason change.
- **Coclerk ADR 0004's privilege model is unchanged.** `privileged.sqlite` is copied as an ordinary file and keeps its access paths.
- **Exclusions already in source cover the folder inside a matter**, and this decision relies on them: housekeeping and file-sorting skip `0`-numbered folders (`file-sorting/profiles/litigation-matter/profile.md`, `housekeeping/SKILL.md`); `zones.ts` refuses `^[01]\.` destinations; ingest walks an allow-list (`case/ingest-coverage.ts`); `file_ops/move.ts` and `trash.ts` protect `0. case data`; `correspondence/message.ts` and `scrutiny-review.ts` exclude it.

This supersedes the location reasoning of Coclerk ADRs 0008 and 0012. The Coclerk documents (`docs/infra/fuse-mount-staleness-investigation.md`, ADRs 0004, 0008 and 0017) are in the retired repository and are not edited.

## Considered options

- **Keep the firm-level location** and grant both folders each session: the grant that failed on 2026-10-21 stays a failure point, for no protection.
- **A per-matter subfolder inside the matter folder** (`0. CASE DATA\<matter_id> <short_name>\`): the matter folder already names the matter, so the extra level adds nothing.
- **Move existing matters automatically on first use**: a silent move of a privileged store. Relocation runs only when the practitioner asks.

## Consequences

- A relocated matter's `submission.sqlite` path changes, so its drafting lock key and any outstanding migrate plan token change with it. The relocate result says to re-run `drafting_forms__open_session` and re-plan any migration.
- The old folder stays under the firm root until the practitioner deletes it. Every resolver prefers the matter's own folder once it holds `main.sqlite`.
- Out of scope: the sync client's "cloud sync provider failed to validate" error and the SQLite disk input-output error (both folders are in the same library), version bumps and bundles, the practice-level stores, and deleting old folders.
