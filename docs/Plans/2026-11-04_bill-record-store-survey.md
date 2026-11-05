# Bill record store survey

Findings for ticket #248, on map #246 "Resumable /bill-client". The ticket asks which of four stores could hold a bill-in-progress record with no new table and no schema DDL, and what each does when two machines write it. This file states facts and precedents. It makes no decision: that belongs to a later ticket.

The record, as the glossary defines it, is "one unfinished bill, identified by the matter and its last signed invoice" and "not an invoice record" (`GLOSSARY.md:224`).

Citation shorthand: `src/` is `source/lawyer/mcp/src/`, `skills/` is `.claude/skills/`, and `spec` is `docs/Specs/2026-11-03_defensible-time-entries-spec.md`. "Inference" marks what was reasoned from the code and not read in it. No real database was opened, and no sync behaviour was tested.

## At a glance

| Store | Fits with no DDL | Existing place for a record | On the synced folder | Cross-machine protection in code | Cloud |
|---|---|---|---|---|---|
| Practice DB | Only through `signal`, with limits | `signal` item | Yes | None | Every write is checked, but clear data does not travel |
| Matter DB | Yes | `matter_metadata` table | Yes, per matter | None (host-local lock only) | None |
| Timecamping DB | Technically | `db_meta` table | Yes | None (host-local lock only) | None |
| time_pipeline store | Yes, no code change | Generic key-value table, under a namespace | Yes | None, and no same-host lock either | None |

## Practice DB

**Fits without DDL: yes through one existing tool, with limits. Any other route needs a code change.**

- `practice.db` holds one generic key-value table and nothing else, with namespaces `item`, `meta` and `pending` (`src/practice/backend.ts:1`, `src/practice/store.ts:27`).
- Every routed write is a named operation (`skills/practice-data/SKILL.md:65`). Inference: no existing tool writes a free key.
- The existing candidate is the `signal` kind. `practice_data__upsert_signal` takes a matter reference, `signal_key`, a required `state`, `confirmed_at` and `note` (`src/schema/practice.ts:537`). It holds one item per matter and `signal_key` (`cloud/items/rules.sql:222`). `note` is a free string, stored locally in clear and sent only as a hash (`src/tools/practice/writes.ts:454`, `src/practice/ops.ts:124`).
- Limits on `signal`:
  - `state` must be `confirmed`, `unconfirmed` or `absent` (`cloud/items/rules.sql:146`, `src/schema/practice.ts:542`).
  - The tool is described as an "engagement lifecycle signal" (`src/schema/practice.ts:538`).
  - `signal_key` leaves the machine raw. It must match lower-case letters, digits and `_ : . -`, and may not contain a matter code (`src/practice/ops.ts:15`, `src/practice/ops.ts:68`, `src/practice/ops.ts:103`).
  - Inference: putting the last signed invoice in `signal_key` would send that value to the cloud raw, so Commandment 3 bears on what it holds. An invoice number is matched only as a hash elsewhere (`cloud/items/rules.sql:219`).
- A new kind needs a rulebook row and a tool. Kinds are a closed list checked in the cloud, and an unknown kind is refused with a question (`cloud/items/rules.sql:111`, `cloud/items/rules.sql:481`).
- A fourth local namespace needs a code change, because `store.ts` names three constants (`src/practice/store.ts:27`). It is not DDL, because the key-value helper takes any namespace (`src/kv/backend.ts:203`). Such a write would bypass `store.write`, and the skill's statement that "every write is checked by Probanda's Cloud" (`skills/practice-data/SKILL.md:11`) would stop being true.
- A new table is refused at run time. A `practice.db` holding any other table is treated as legacy, with nothing read or written (`src/kv/backend.ts:43`, `src/kv/backend.ts:225`, `src/practice/backend.ts:70`).

**File location:** `_practice\practice.db` under the case-data root (`src/practice/backend.ts:33`), which is in the synced folder (`spec:120`, `spec:206`).

**Two-machine behaviour, from the code:**

- No lock, no staging and no host check. The helper opens the live file directly on every call, reads included (`src/kv/backend.ts:33`, `src/kv/backend.ts:227`).
- Pending writes, the tenant, the hash key and the sync sequence all live in the same file (`src/practice/store.ts:142`, `src/practice/store.ts:162`).
- Cloud sync brings back only metadata. An item from sync keeps `data: current?.data ?? {}` (`src/practice/store.ts:239`), so another machine's `note` does not arrive through the cloud. Inference: it could arrive only by file sync.

**Where the documents and the code differ:** spec §5 said the cloud solves two machines (`spec:114`, `spec:120`). Spec §13 marks that "Refuted": "`practice.db` sits in the same synced folder, with the same risk as any SQLite file" (`spec:206`).

**Cloud involvement:**

- A write stores a pending entry, then posts to `items-write` (`src/practice/store.ts:155`). The post carries tenant, write id, tool, intent and each op's id, kind, state, tags, links and field hashes (`src/practice/ops.ts:41`). The cloud checks it against the rulebook (`cloud/items/README.md:11`).
- Cloud unreachable: the write fails, the pending entry is removed and nothing is saved (`src/practice/store.ts:168`, `src/practice/cloud.ts:21`).
- Connection reset: the outcome is unknown and the entry stays pending (`src/practice/store.ts:169`).
- Reads never call the cloud (`src/practice/store.ts:15`), but any practice tool call first replays pending writes. A replay failure blocks a write, not a read (`src/tools/practice/index.ts:140`).

**Precedent:** the matter-plus-key upsert with a stable id (`cloud/items/rules.sql:222`), and the replay under the original write id.

## Matter DB

**Fits without DDL: yes.**

- The existing candidate is `matter_metadata`, a generic table of a text key and a text value, one per matter database (`skills/matter-data/references/schema.sql:222`). It already holds seed keys and a `mail_folder` key written the same way (`skills/matter-data/operations/initialize.md:249`, `skills/matter-data/operations/mail-folder.md:10`).
- `matter_data__execute` takes a script or a generator (`src/dispatch.ts:147`). The helper runs the script as given in one transaction, with no statement filter (`src/case/backend.ts:425`), so the code does not refuse DDL. The rule against new tables is a skill and repo rule in this path. The only size cap is 8 KB, on runs the orchestrator began (`src/dispatch.ts:163`, `src/case/ingest-run.ts:81`).
- The skill scopes the store to the matter's "structured case data" (`skills/matter-data/SKILL.md:20`). `housekeeping_reviews` is labelled "operational run-state, not case data" (`skills/matter-data/references/schema.sql:636`), so run-state in this store has a precedent.
- Side effects: every mutation regenerates the `evidence.sql` text dump (`src/case/backend.ts:443`), and every call rewrites the pointer files in the matter root (`src/case/backend.ts:131`). A matter with no `main.sqlite` cannot answer a query (`src/case/backend.ts:249`).

**File location:** `main.sqlite`, `law.sqlite` and `privileged.sqlite` in the matter folder's `0. CASE DATA\`, inside the synced library. An older matter keeps them in the firm-level `0. CASE DATA\<matter_id> <short_name>\` until relocated (`skills/matter-data/shared/conventions.md:34`).

**Two-machine behaviour, from the code:**

- A write takes a host-local lock, stages temp copies, then replaces all three files by rename, with rollback on failure (`src/case/backend.ts:280`, `src/case/backend.ts:412`).
- The lock file is in the local app data folder, so it does not cross machines (`src/data-lock.ts:60`).
- `expected_revision` is "a count on this computer" (`src/case/case-lock.ts:81`).
- Inference: with two machines staging from their synced copies, the later replace wins. The code read has no check for this.

**Where the documents and the code differ:** `src/case/case-lock.ts:20` says cross-machine concurrency "is caught instead by the plan-token freshness check". The plan token belongs to `matter_data__migrate` (`skills/matter-data/operations/migrate.md:30`), and `matter_data__execute` carries none (`src/dispatch.ts:147`). For an ordinary execute the claim does not hold.

**Cloud involvement:** none. "All case data is local SQLite; there is no cloud backend" (`skills/matter-data/SKILL.md:20`).

**Precedent:** `mail_folder` as a single per-matter key (`skills/matter-data/operations/mail-folder.md:10`), and `housekeeping_reviews` as run-state keyed by file hash and name (`skills/matter-data/references/schema.sql:636`).

## Timecamping DB

**Fits without DDL: technically yes, through `db_meta`.**

- `db_meta` has a key and a non-null value (`skills/timecamping-data/references/schema.sql:9`). Its documented use is the schema version (`skills/timecamping-data/SKILL.md:136`).
- In `source_fetch_log`, `source_name` is the source's table name, the gate joins on it, and each row holds a status for one source and date (`skills/timecamping-data/SKILL.md:147`). Inference: it is not shaped for this record. `proposals`, `determinations` and `presumptions` have specific purposes and closed-value columns (`skills/timecamping-data/SKILL.md:194`).
- `execute` runs any script in one transaction with no statement filter (`src/timecamping/backend.ts:86`), so the code does not refuse DDL. The skill forbids inventing a table or column (`skills/timecamping-data/SKILL.md:207`). `query` allows only SELECT, WITH or PRAGMA (`src/timecamping/backend.ts:67`).
- The skill describes the store as per practitioner, and "not the authority" on billed time (`skills/timecamping-data/SKILL.md:4`, `skills/timecamping-data/SKILL.md:20`).

**File location:** `_practice\timecamping.db` under the case-data root, so on the synced folder (`src/timecamping/backend.ts:41`, `src/timecamping/backend.ts:21`, `spec:214`).

**Two-machine behaviour, from the code:**

- A write takes a host-local lock, copies the file to temp, mutates it, then flushes a sibling and renames it over the live file (`src/timecamping/backend.ts:261`, `src/staged-store.ts:25`, `src/staged-store.ts:37`).
- The lock is explicitly host-local (`src/timecamping/lock.ts:21`). Reads open the live file directly in read-only mode (`src/timecamping/backend.ts:72`).
- The copy-back has no check that the live file is unchanged since staging (`src/staged-store.ts:48`). Inference: across machines, the later copy-back discards the earlier write, the same loss `src/timecamping/lock.ts:15` describes for two processes on one host.

**Where the documents and the code differ:** spec §5 says the database "must be written from one machine at a time" (`spec:120`). No code enforces that.

**Cloud involvement:** none. The backend imports no cloud module (`src/timecamping/backend.ts:28`).

**Precedent:** the copy-write-copy-back itself, and a gate that refuses work on incomplete prerequisites (`skills/timecamping-data/SKILL.md:34`).

## time_pipeline store

**Fits without DDL: yes, with no code change.**

- `time_pipeline__set` writes a namespace, key and string value to a table that already exists (`src/schema/time-pipeline.ts:27`, `src/dispatch.ts:213`, `src/time-pipeline/backend.ts:87`, `src/kv/backend.ts:241`).
- The namespace list is not enforced in code. The schema has no enum for it (`src/schema/time-pipeline.ts:29`), and the backend "holds no knowledge of what a namespace or key means" (`src/time-pipeline/backend.ts:20`). The skill's list of four is a document rule: "A fourth namespace is a routing decision" (`skills/time-pipeline-data/SKILL.md:81`, `skills/time-pipeline-data/SKILL.md:134`). Adding one needs a skill edit, no code and no DDL.
- Limits:
  - The value is one string, stored verbatim and never parsed (`skills/time-pipeline-data/SKILL.md:97`).
  - `set` overwrites with no compare (`skills/time-pipeline-data/SKILL.md:39`, `src/kv/backend.ts:242`).
  - `delete`, and a `bulk_apply` that replaces or removes, wait for the practitioner's pasted approval (`source/timekeeper/plugin.json:23`, `source/timekeeper/hooks/one-way-gate.py:37`). `set` is not in that matcher.
  - The existing `evidence` namespace is limited to "metadata and references only" (`skills/timecamping-data/SKILL.md:89`).
- Packaging: `bill-client` ships in `lawyer` and `time-pipeline-data` in `timekeeper` (`source/assignment.json:9`, `source/assignment.json:199`). The tools stay in `lawyer`'s server (`CLAUDE.md:97`), and `lawyer` "names nothing in another plugin" (`CLAUDE.md:100`). `bill-client` already stops without `timekeeper` for its time work (`skills/bill-client/SKILL.md:65`).
- The skill's text disagrees with itself: it says four namespaces exist (`skills/time-pipeline-data/SKILL.md:81`) and later "the three above" (`skills/time-pipeline-data/SKILL.md:134`).

**File location:** `_practice\time_pipeline.db` under the case-data root, so on the synced folder (`src/time-pipeline/backend.ts:32`, `skills/time-pipeline-data/SKILL.md:20`).

**Two-machine behaviour, from the code:**

- No protection: no lock, no staging, no host check and no replay. Every call opens the live file, reads included (`src/kv/backend.ts:33`, `src/kv/backend.ts:227`).
- `set` is one upsert and commit (`src/kv/backend.ts:241`). Inference: concurrent writers on one synced file get the last write per key. No code addresses corruption from sync.
- `bulk_apply`'s `expect` is an optimistic check, but only against that machine's copy (`src/kv/backend.ts:157`).

**Where the documents and the code differ:** the skill says nothing about sync or machines, and its one protection claim, one transaction per call (`skills/time-pipeline-data/SKILL.md:119`), matches the code. `src/timecamping/backend.ts:21` names this same file as being in the tree where a live handle risks corruption.

**Cloud involvement:** none (`skills/time-pipeline-data/SKILL.md:110`). The backend imports no cloud module (`src/time-pipeline/backend.ts:25`).

**Precedent:**

- The practitioner put new evidence kinds in a namespace here, "No schema change" (`spec:218`).
- Per-matter keys in a family scheme, `triage:<matter>:<date>` and `service_list:<matter>` (`skills/timecamping-data/SKILL.md:89`).
- `bulk_apply`'s preview-then-expect (`src/kv/backend.ts:157`), and `export`, which writes the store's rows to a file (`src/kv/backend.ts:172`).

## Precedents

**Lease and journal, `src/case/ingest-run.ts`.**

- How it works: each run has a folder with `lease.json` and an append-only `journal.jsonl` (`src/case/ingest-run.ts:2`, `src/case/ingest-run.ts:198`). Ownership follows the run id, not a process id (`src/case/ingest-run.ts:4`). A resume issues a new run id, so the displaced session is refused at its next call (`src/case/ingest-run.ts:1528`, `src/case/ingest-run.ts:380`).
- What it guarantees: plans come "from the journal alone (so a resume after a crash or a compaction needs no memory" (`src/case/ingest-run.ts:9`). A torn last line is dropped or skipped (`src/case/ingest-run.ts:264`). A lease is live for 60 minutes of heartbeat (`src/case/ingest-run.ts:40`).
- What stops it crossing machines: run state "never reaches the synced matter folder" (`src/case/ingest-run.ts:3`). The run root is in local app data (`src/data-lock.ts:60`), and the folder key hashes the absolute matter path (`src/data-lock.ts:53`). A resume on another computer answers `unknown_run` (`src/case/ingest-run.ts:154`).
- What it leaves unprotected: there is no cross-machine continuity at all. A run's folder is deleted 30 days after it ended or last heartbeat (`src/case/ingest-run.ts:41`).

**Replay of pending writes, `src/practice/store.ts`.**

- How it works: the write goes in `pending`, then to the cloud, then items, sync sequence and pending removal land in one local transaction (`src/practice/store.ts:1`, `src/practice/store.ts:155`). Each tool call first replays pending writes with their original ids (`src/practice/store.ts:182`, `src/tools/practice/index.ts:140`). The cloud returns the stored result for a repeated write id (`cloud/items/README.md:9`).
- What it guarantees: one save at the cloud per write id, and a local apply that lands whole or not at all (`src/practice/store.ts:274`, `src/kv/backend.ts:203`).
- What it leaves unprotected: clear data does not travel through the cloud (`src/practice/store.ts:239`, `spec:206`). The local file has no lock, and the pending entry sits in the same synced file. Inference: a synced copy could be replayed by another machine under the same write id, and no code read addresses that.

**Copy-write-copy-back, `src/timecamping/backend.ts`.**

- How it works: see the Timecamping DB section (`src/timecamping/backend.ts:18`, `src/staged-store.ts:17`).
- What it guarantees: a kill leaves the file "old or new, never torn" (`src/staged-store.ts:26`), same-host writers cannot lose each other's writes (`src/timecamping/backend.ts:253`), and no live write handle sits on the synced file.
- What it leaves unprotected: writers on different machines (`src/timecamping/lock.ts:21`, `src/staged-store.ts:48`). A broken stale lock produces only a warning (`src/timecamping/backend.ts:270`). Non-success does not prove nothing committed (`skills/timecamping-data/SKILL.md:30`). Reads are not staged (`src/timecamping/backend.ts:72`).

## Constraints read

**`CLAUDE.md`, "Never commit":**

- "SQL files or schema DDL." The legacy schemas are covered "until each legacy store is converted and leaves the list in the Exception of COMMANDMENTS.md. No change may add any." (`CLAUDE.md:74`)
- "No change may add a problem of any kind." A ruling is human-only: "only a person adds a ruling" (`CLAUDE.md:84`).

**`COMMANDMENTS.md`:**

- "no revision may make the development plugin rely on this exception more than it already does." (`COMMANDMENTS.md:36`)
- "For local databases, this exception covers only the legacy stores matter-data, drafting-data and timetracking-data. A store leaves this list once it complies, and no store is ever added." (`COMMANDMENTS.md:36`)
- Commandment 5: "It has no table, column or file per tag type or link role." (`COMMANDMENTS.md:28`)

**Each store against the Exception's list:**

- Matter DB: listed, as matter-data.
- Practice DB: not listed. It left the list on conversion (`docs/Plans/2026-10-14_practice-db-conversion.md:3`).
- time_pipeline store: not listed under any name.
- Timecamping DB: not listed under that name. See Not established.

**The spec on a draft invoice record:** "K is first written at issue, in the one write that locks H, not as a draft. A draft invoice record would move the matter's billing cutoff before anything was billed." (`spec:225`)

**The spec on JSON Lines files:** "Never the live record" (`spec:116`).

**The spec on merging into the time-evidence database:** dropped, because it "would deepen reliance on the Commandments' Exception" (`spec:207`).

## Not established

- Whether "timetracking-data" in the Exception means the timecamping DB. No file read maps the names. Inference: `spec:207` treats the time-evidence database as relying on the Exception.
- Whether a new row in `cloud/items/rules.sql` counts as a new problem under `scripts/check_publishable.py`, or as "SQL files or schema DDL". The script's treatment of it was not read or tested.
- Whether a repo rule outside the files read forbids `matter_metadata` or `db_meta` for this use. None appeared.
- What sync actually does to any of these files when two machines write. Every such statement above comes from code comments and the spec, not from a test.
- How two machines holding separately synced copies of `practice.db` behave at the cloud: replay of a synced pending entry, or sync sequence drift. The code shows the inputs only.
- Whether `read_signals` returns `note`. It returns rows flattened from items (`src/tools/practice/reads.ts:355`), and `src/practice/items.ts` was not read.
- Whether a signal can be removed. No routed tool deletes one (`skills/practice-data/SKILL.md:65`), and `state: absent` is the only ending seen.
- `src/case/ingest-run.ts` lines 970 to 1494 and 1585 to the end were not read, so a later action there could add behaviour not described above.
