# migrate — upgrade the databases to schema v9.0

Runs through the `matter_data__migrate` tool, host-side, from **any** environment
— a local CLI session and a Cowork session use the identical path. The tool
resolves the pointer with the schema-version guard bypassed, which is the whole
reason migrate needed its own tool rather than riding `matter_data__execute`:
migrate's entire job is to run against a database the guard exists to refuse.

Read `../shared/conventions.md` first. The tool contract, temp-copy staging and
`PRAGMA journal_mode = DELETE` are defined there and are not restated here.

**Run this operation through the `lawyer:migration-runner` subagent.** If you are not
that subagent, spawn it (Agent tool, fresh context, `model: opus`) and relay its
checkpoints to the practitioner — do not call `matter_data__migrate` yourself. The
subagent's job is judgment the tool cannot supply: is this the right plan for
this matter, do the before/after counts make sense, and should we stop. Note
that this routing is **instructional, not technical** — an MCP server cannot
verify which model issued a call. What actually prevents harm is the tool's own
plan-token gate and automatic backup (§2), which hold whoever calls it.

**If `matter_data__migrate` is not in the session's tool list, halt and report.**
Never fall back to `references/scripts/` from a Cowork session — see §5.

---

## 1. The four modes

| Mode | Arguments | Effect |
|---|---|---|
| `plan` | `matter_root` | Dry-runs the whole chain on temp copies, returns the step list, before/after evidence, and a `plan_token`. Natives untouched. |
| `apply` | `matter_root`, `plan_token`, `user_confirmation` | Backs up, re-runs the chain, replaces all three databases together, regenerates `evidence.sql`. |
| `restore` | `matter_root`, `backup_id`, `user_confirmation` | Puts a backup set back, after taking its own safety backup. |
| `backups` | `matter_root` | Lists this matter's backup sets. Read-only. |

Every mode is annotated destructive, `plan` included: pointer resolution
rewrites `probanda.json` and may move binaries out of the legacy `9. AI` folder.

## 2. The gate

`apply` is unreachable without three things, all checked before any native file
is touched:

1. A **`plan_token`** from a recent `plan`. It is a hash over the matter paths,
   the three databases' content hashes, the starting versions, the resolved step
   list, and the bytes of `migrations.sql`, `triggers.sql`, `queries.sql` and
   `rebuild.py`. Anything that would change what apply does invalidates it. It
   needs no expiry: after a successful apply the database hashes have changed,
   so a token cannot verify twice.
2. The exact **`user_confirmation`** string the plan returned as
   `user_confirmation_required` (`MIGRATE <matter> v<from> -> v9.0`), echoed
   back verbatim from the plan result. This is a freshness echo tied to the
   plan, not an approval step: apply on a clean dry-run needs no practitioner
   sign-off. What gates apply is the caller's review of the dry-run evidence
   (row-count parity, integrity, a contiguous chain) plus the token and the
   backup.
3. A **host-local backup** of all three binaries plus the pointer and
   `evidence.sql`, written and hash-verified before the chain runs.

## 3. What the tool does internally

Documented the way `../shared/conventions.md` §3 documents `execute` — for
anyone debugging `../references/scripts/migrate_engine.py`, not as something an
operation file implements.

The chain is a list of one-version hops. Each hop is served by either a
**marker** step (SQL from `../references/migrations.sql`, delimited by
`-- MIGRATE <from> -> <to> -- DB: <main|law|privileged>`) or a **carve-out**
step (a named in-temp function in `../references/scripts/rebuild.py`). A hop
served by neither is a hard fail — migrate never skips a schema generation.
Carve-outs exist because some changes cannot ride an `ALTER TABLE`:

| Hop | Owner |
|---|---|
| 69 → 70 | `rebuild.upgrade_69_to_70` — adds `authorities.cloud_authority_id`, rebuilds `legal_concepts` with the up-pointer columns and their cross-column CHECKs (which cannot ride `ALTER TABLE`), creates `issue_concepts`, asserts row-count preservation |
| 74 → 75 | `rebuild.upgrade_74_to_75` — rejects deprecated `plaintiff_by_counterclaim` rows, rebuilds the role table, asserts row-count preservation |
| 75 → 76 | `rebuild.upgrade_75_to_76` — rebuilds factual positions under the v7.6 enum and uniqueness constraint, adds the relief/reference tables |

The `69 → 70` hop was a dead end until 2026-09-10: `rebuild.upgrade_69_to_70`
existed but nothing registered it, so a matter at v6.9 or below failed closed
there. It is now a carve-out in the same table, and a v6.2 database walks the
full chain to the target (`tests/test_migrate_engine.py::FromV62Tests`).

The **host-local lock** every mode takes is shared with `matter_data__execute`, so
a write and a migration on one matter can never interleave; contention refuses
with `lock_unavailable` rather than queueing. `matter_data__query` is deliberately
outside it. See `../references/design-decisions.md` #28 for why the lock is host-local rather than in
the matter directory, and why its stale-break is 15 minutes.

`apply` in order: take the host-local lock → refuse if this matter root's
in-flight marker shows a previous apply died (the marker is scoped to the root,
because a scratch copy with the same stored identity shares the backup folder)
→ resolve the pointer with the guard bypassed →
back up → recompute the token from scratch and compare → check the confirmation
→ stage from the **backup copies** (so the working set provably equals what a
restore would return) → drop all views → run each hop, stamping all three
databases after each → stamp 90 → attach, load `triggers.sql`, assert the
trigger count is non-zero, rebuild the views from `queries.sql` → check the
table-count floor and `PRAGMA integrity_check` (hard) and `foreign_key_check`
(reported, never blocking — pre-existing violations must not block a schema
migration) → build the dump text in memory → copy the finished binaries and
rollback copies into a sidecar **inside** `case_data_dir` and `fsync` → replace
the three natives by rename → write `evidence.sql`.

The last two steps are why the sidecar is inside `case_data_dir`: `os.replace`
is atomic only within a volume, and `COCLERK_CASE_DATA_ROOT` may point at
another drive. Every connection is closed long before anything reaches the
sidecar, so no live handle is ever held on synced storage.

**On any exception before the renames, the native files are untouched.** If a
rename fails partway, the rollback copies are already on the same volume and go
back by rename. If `evidence.sql` then fails to write, the migration is **not**
rolled back — the binaries are correct and the dump is stale; the result says so
and `maintain` dump mode fixes it.

## 4. Reading the result

`plan` returns `from_version`/`target_version`, the ordered `steps` (each with
`fired`, so a no-op carve-out is visible), and `dry_run` carrying
`triggers_loaded`, `views_created`, `table_counts`, `integrity_check`,
`foreign_key_violations`, `row_counts_before`/`row_counts_after`, and the dump
header. Row counts must agree table by table: a migration adds structure, not
rows.

For the v7.9 → v8.0 hop, existing facts and positions receive
`pending_reverification = 0`. Existing `verified = 1` rows are grandfathered:
the old schema did not preserve correction history, so migration must not infer
it. If a practitioner identifies known suspect row IDs, quarantine those rows
after migration through a separate governed matter-data write that atomically sets
`verified = 0, human_reviewed = 0, pending_reverification = 1` and records why.

The v8.0 → v8.1 hop adds the `admissions` table and nothing else. It is purely
additive: no existing row is read, rewritten, or backfilled, and a matter that
never records an admission is indistinguishable from its v8.0 self apart from
the stamped version. Row counts are therefore unchanged across this hop, and the
table-count assertion moves from 21 to 22 on `main`.

The v8.1 → v8.2 hop adds two nullable columns to `main.parties`
(`service_address_filed_date`, `replaced_representative`) and nothing else. No
existing row is read or rewritten. Row counts are unchanged across this hop,
and **the table-count assertion does not move — `main` stays at 22.**

The v8.2 → v8.3 hop widens `proceeding_parties.role` to add `'appellant'`. It
is a table rebuild (CREATE new / INSERT SELECT / DROP / RENAME), the same
shape as the v7.1 → v7.2 hop, not an `ALTER TABLE`. Every existing row is
copied across unchanged — no role value is removed or rewritten — so row
counts are unchanged and **the table-count assertion does not move — `main`
stays at 22.**

The v8.3 → v8.4 hop adds the `sought_orders` table and nothing else. It is
purely additive: no existing row is read, rewritten, or backfilled, and a
matter that never captures a Notice of Application's Part 1 is
indistinguishable from its v8.3 self apart from the stamped version. Row
counts are therefore unchanged across this hop, and **the table-count
assertion moves from 22 to 23 on `main`.**

The v8.4 → v8.5 hop is the **first hop on `law`** since v7.3. It widens three
CHECK constraints — `authorities.authority_type` (+ `'oral_reasons'`),
`authority_treatments.treatment` (+ `'follows'`, `'declines_to_follow'`,
`'not_considered'`) and `concept_authorities.relationship` (+ `'answered'`) —
and adds two nullable local-only capture columns, `concept_authorities.pinpoint`
and `concept_authorities.excerpt`. All three are table rebuilds (CREATE new /
INSERT SELECT with explicit column lists / DROP / RENAME), and because
`authorities` is a parent table the whole hop runs inside an explicit
`PRAGMA foreign_keys = OFF; … PRAGMA foreign_keys = ON;` bracket — the engine
sets `foreign_keys = ON` before each marker, and rebuilding a parent under it
would fail. Every existing row is copied across unchanged and no value is
removed, so row counts are unchanged and **the table-count assertion does not
move — `law` stays at 5.** `pinpoint`/`excerpt` are born NULL for every existing
edge, which is the honest backfill.

The v8.5 → v8.6 hop is on `privileged`. It makes
`client_instructions.proceeding_id` nullable, so an instruction can be recorded
on a matter with no proceeding; `party_id` stays `NOT NULL`. SQLite cannot drop
a `NOT NULL` in place, so it is a table rebuild (CREATE new / INSERT SELECT with
explicit column lists / DROP / RENAME) that then recreates the table's three
indexes. `client_instructions` references itself through `prior_id`, so the hop
runs inside the same `PRAGMA foreign_keys = OFF; … ON;` bracket as the
v8.4 → v8.5 hop. Every existing row and `prior_id` chain is copied across
unchanged, so row counts are unchanged and **the table-count assertion does not
move — `privileged` stays at 3.**

The v8.6 → v8.7 hop is on `main`. It adds the nullable
`sources.privilege_status` column (`'pending'` | `'cleared'`, no DEFAULT), whose
cross-column CHECK refuses `listed = 1` while pending, then backfills
`'pending'` on every row whose `notes` start `PRIVILEGE REVIEW PENDING`. Every
other row stays NULL, and the notes themselves are not rewritten. **The hop
fails closed:** a legacy row carrying that note that is already `listed = 1`
fails the CHECK, and the whole migration stops with the natives untouched. That
row has to be resolved by hand, either taken off the list or its note
corrected, before the migration is re-planned. No row is added or removed, so
row counts are unchanged and **the table-count assertion does not move — `main`
stays at 23.** See `../references/design-decisions.md` #49.

The v8.7 → v8.8 hop is on `main`. It rebuilds `housekeeping_reviews`: the
`outcome` CHECK gains `not_ingested` and `ingest_failed`, `folder_type` becomes
nullable, and three nullable columns arrive (`reason`, `failure_class`,
`retry_next_run`). `declined` stays in the CHECK, so every existing row is
copied across unchanged, its new columns NULL. The table has no foreign key in
either direction, so the hop needs no `PRAGMA foreign_keys` bracket. Row counts
are unchanged and **the table-count assertion does not move — `main` stays at
23.** See `housekeeping-log.md` for what the new values mean.

The v8.8 → v8.9 hop is on `main`. It adds two nullable columns to `parties`
(`lawyer_email`, `lawyer_phone`) and six nullable per-proceeding override
columns to `proceeding_parties` (`lawyer_name`, `lawyer_firm`, `lawyer_email`,
`lawyer_phone`, `address`, `service_address_filed_date`), every existing row
reading NULL in each. Purely additive: no row is rewritten, row counts are
unchanged and **the table-count assertion does not move — `main` stays at
23.** See `../references/design-decisions.md` #55.

The v8.9 → v9.0 hop is on `main`. It adds two tables: `tribunal_members`
(judges, arbitrators, tribunal members and registrars, who are participants but
not parties) and `participant_aliases` (other spellings of a participant's name
and the firm's file-name codes for them). Purely additive, with no backfill: no
existing row is read or rewritten, row counts are unchanged, and **the
table-count assertion moves from 23 to 25 on `main`.** See
`../references/design-decisions.md` #65.

`apply` returns the same plus `backup_id`, `backup_dir`, `post_user_version`,
`post_sha256` and `evidence_sql_written`. **Success may be reported only after
the dump header reads `schema v9.0`** — check `evidence_sql_written`, and
confirm the ordinary surface works by running one `matter_data__query` afterwards.

Refusal codes: `no_migration_path` (gapped chain), `version_stamps_disagree`
(the three databases carry different stamps — an interrupted or hand-edited
state migrate will not guess at), `plan_token_mismatch`, `confirmation_mismatch`,
`apply_interrupted`, `lock_unavailable`, `backup_not_found`, `backup_corrupt`,
`migrate_refused`.

## 5. The E1 script path

`../references/scripts/` still holds the standalone CLIs, and in a **local
command-line session only** they remain available for recovery if the tool
itself is broken — see `../references/scripts.md`. They are the fallback, not
the operative procedure. One caution: running
`rebuild.py --migrate` requires overwriting `evidence.sql` with a v7.4 dump
first, which destroys the durable text record of the pre-migration state
(matter-data `design-decisions.md` #5). The tool exists partly to avoid that.

From Cowork, absence of the tool means **halt and report** — never stage or
execute a script through the mount.
