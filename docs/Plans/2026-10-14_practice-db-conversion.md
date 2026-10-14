# Plan: convert practice.db to comply with Commandments 4 and 5

Written 2026-10-14. Nothing is built yet. On completion, practice-data is the first legacy store to leave the list in Exception 4 of `COMMANDMENTS.md`.

## Context

Exception 4 lets four legacy local stores keep Trade Secrets while they are converted: case-data, drafting-data, timecamping-data and practice-data. A store leaves the list once it complies with Commandments 4 and 5. practice-data goes first because no skill embeds SQL against it. Skills reach it only through the `practice_data__*` tools of the `data` server.

Today the data server ships the store's rulebook to the user's machine. That is the violation this plan removes:

- `source/probanda/mcp/src/practice/backend.ts` holds the DDL: 15 tables in `SCHEMA_SQL` plus 7 rebuild copies in the embedded Python migrations, 22 `CREATE TABLE` statements in all. It also holds 13 migration functions that encode each table's constraints.
- `source/probanda/mcp/src/practice-registry.ts` is a table list (`PRACTICE_ENTITIES`) with every column and enum.
- `source/probanda/mcp/src/tools/practice/` holds the write rules: `writes.ts` (anchor state machine, deadline supersession, one open to-do per filing, billable inheritance), `shared.ts` (the eight lifecycle policies in `DEFAULT_POLICIES`), `invoices.ts` (merge rules and the cutoff regression gate) and `rule-overlay.ts` (the overlay record contract).
- Local storage has a table and columns per kind of item, which Commandment 5 forbids.

The outcome: practice.db becomes one generic table holding items, tags and links. The rulebook and the write checks move to Probanda's Cloud. Reads stay local and work offline. A write is saved only when the cloud accepts it, and the cloud sees only Metadata, Cross Data and keyed hashes, never User Data.

## Decided by Brahm (not open)

1. Probanda's Cloud is one Supabase project, ref `nbzkuhgiqscjkypedqff` (being renamed from legal-commons to "Probanda").
2. The rulebook and the write checks live in a private Postgres schema, `rules`, that is not among the project's exposed API schemas and grants nothing to `anon` or `authenticated`. Only edge functions reach it, server-side.
3. Users keep the one credential they already configure for the commons server. No second credential.
4. Free plan. On 2026-10-14: database 30 MB of 500 MB, edge function calls 946 of 500,000 a month.
5. Added 2026-10-14: a link that a local read needs (a time entry's matter, a deadline's anchor) is Cross Data. It is stored locally in generic form and the cloud holds a copy. Exception 1 then covers only links that the rules alone use, which stay in the cloud.

## What the files show (2026-10-14)

- **Callers.** No skill, agent, hook or script reads practice.db except through the tools. Inside the server, `dispatch.ts:519`, `submission/matter-dates.ts:67`, `submission/matter-todos.ts:29` and `submission/open-session.ts:271` call `callPracticeTool` and read `matter_lookup`, `active_deadlines` and `open_tasks` rows. `render_practice_board` reads through the same admin object.
- **Skill prose names the tables.** `task-prioritization`, `executive-assistant`, `wip-tracker`, `ar-follow-up`, `matter-status-tracking`, `file-review-prep`, `invoice-reviewing`, `time-entry-drafting`, `case-data/references/terminology-crosswalk.md`, `drafting-data` and `practice-data` itself name tables or columns (`matters.status`, "the `deadlines` table", `practice_anchors`). None embeds SQL.
- **Response fields skills rely on** are the current row fields, flattened: `id`, `matter_id`, `anchor_id`, `status`, `review_flag`, `scenario_label`, `filing_ref`, the nudge fields, `regular_trust`, `cutoff_date`, `cutoff_source`, `client_name`, `matt_num` and so on. `matter-status-tracking` also reads `read_signals.policies` (`auto_advance`, `required_signals`) and computes the next status itself.
- **The commons credential** is the project's secret key (`sb_secret_` or `service_role`), DPAPI-encrypted at `%LOCALAPPDATA%\Coclerk\legal-commons\credential.json.dpapi` by `commons-mcp/src/dpapi-store.ts` and `legal-commons/config.ts`. It is one shared key and carries no user identity. The data server has no Supabase or DPAPI code today.
- **Edge functions** live in `cloud/legal-commons/supabase/functions/`, check the caller with `callerSecretKey` in `_shared/pool.ts` (the `apikey` header against `SUPABASE_SECRET_KEYS`), and deploy with `supabase functions deploy --use-api --project-ref nbzkuhgiqscjkypedqff --workdir cloud/legal-commons`. No network failure or paused project is handled anywhere today: a failed `fetch` surfaces as "fetch failed".
- **`check_publishable.py`** exempts every tracked file under `cloud/` from the DDL and `.sql` checks. Its DDL pattern matches uppercase `CREATE TABLE|INDEX|TRIGGER` and `ALTER TABLE`. A moved line adds no problem, a copied or changed one does.
- **A generic local table already exists.** `time-pipeline/backend.ts` keeps `time_pipeline.db` as one `kv_store (namespace, key, value JSON, updated_at)` table beside practice.db.
- **Tests.** Twelve `practice-*.test.mjs` files in `source/probanda/mcp/test/` (unit and db tiers), run by `npm test` in `source/probanda/mcp/`. The pool's SQL is tested by `cloud/legal-commons/tests/build_scratch_test.mjs`, which writes one script that runs in a scratch schema and drops it.

## Design

### Local storage

practice.db holds one table, the existing generic `kv_store`, and no other. The DDL text moves from `time-pipeline/backend.ts` into a shared module `src/kv/` that both backends use, so no DDL line is added. Namespaces:

| Namespace | Key | Value |
|---|---|---|
| `item` | the item's UUID | `{kind, data, tags, state, links, created_at, updated_at}` |
| `meta` | `tenant`, `hash_key`, `sync_seq`, `format` | the tenant UUID, the 32-byte hash key (base64), the last sync position, the format marker |
| `pending` | a write's UUID | a write sent or about to be sent, until it is applied locally |

- `kind` is a tag value such as `task` or `deadline`. `tags` is an object of vocabulary values (`task_type: "client"`, `billable: false`). `state` is one vocabulary value. `links` is an object from role to item ID (`matter`, `client`, `anchor`, `filing`). `data` holds every other field, verbatim.
- No table, column or file exists per kind, tag type or link role (Commandment 5). Reads filter items in memory or with `json_extract`, with no DDL.
- `hash_key` and `tenant` live in practice.db so every machine that opens the SharePoint-synced file shares them. `hash_key` is never sent anywhere.
- The server refuses to open a practice.db that holds any table other than `kv_store`, with an error that names the migration (step 7). That test lists no table names.

### How each current table maps

Every row keeps its UUID as the item ID, so IDs held by skills, Job Board pages and `filing_ref` values stay valid. `owner_id` is dropped (it is always `local`).

| Table | `kind` | `links` | `tags` and `state` | `data` (local only) |
|---|---|---|---|---|
| `practice_clients` | `client` | none | none | name, client_num, orig_lawyer, resp_lawyer, type_of_law, major_client |
| `practice_matters` | `matter` | `client` | `billable`, state = `status` | description, file_number, matt_num, orig_lawyer, resp_lawyer, type_of_law, regular_trust, term_trust, last_trust_date |
| `practice_time_entries` | `time_entry` | `matter` | `billable` | description, entry_date, hours, batch_tag |
| `practice_invoices` | `invoice` | `matter` | none | invoice_number, issue_date, date_to, amount, amount_paid, status, last_import_at |
| `practice_tasks` | `task` | `matter`, `filing` | `task_type`, state = `status` | description, time_estimate_hours, actual_hours, deadline_date, completed_at, next_nudge_date, nudge_interval_days, last_nudged_at |
| `practice_retainer_notices` | `retainer_notice` | `matter` | none | sent_at |
| `practice_anchors` | `anchor` | `matter`, `filing` | `anchor_type`, state = `status` | anchor_date, party_label, proceeding_label |
| `practice_anchor_sources` | `anchor_source` | `anchor` | state = `status` | source_document, source_excerpt, stated_date, asserted_date |
| `practice_deadlines` | `deadline` | `matter`, `anchor` | `deadline_type`, `source_type`, `review_flag`, state = `status` | source_document, deadline_date, rule_ref, rule_description, review_note, party_label, proceeding_label, scenario_label, expiry_notified_at |
| `practice_payment_in_flight` | `payment` | `matter` | state = `cleared` | amount, recorded_at, expected_clear_by, notes |
| `practice_matter_signals` | `signal` | `matter` | `signal_key`, state = `state` | note, confirmed_at |
| `practice_status_policies` | none | | | Not kept locally. The eight policies are rulebook and move to `rules` (see migration). |
| `practice_court_calendar_coverage` | `calendar_year` | none | state = `status` | year, source_document, checked_at |
| `practice_court_calendar_days` | `calendar_day` | none | `status_category` | calendar_date, status_label, courthouse_scope, source_document |
| `practice_rule_overlay` | `rule_overlay` | none | `deadline_type`, `amending_reg`, state = `status` | record (the full JSON record) |

`filing_ref` (`filing:<id>` or `proceeding:<id>`) becomes a `filing` link, stored as the same string. Reads flatten an item generically back to the old row: `id`, every `data` field, every tag as a field, the state under its old field name, and each link as `<role>_id`, except `filing`, which flattens to `filing_ref`. The flattening is one generic function with a small map of the three state field names (`status`, `state`, `cleared`).

### What the cloud holds

Two private schemas in the project, neither exposed through the API nor granted to `anon` or `authenticated`:

- **`rules`**: the rulebook and the checks. Vocabularies and allowed state transitions per kind, the eight lifecycle policies, the natural keys, and one entry point `rules.apply_write(tenant uuid, write jsonb) returns jsonb` with a function per kind behind it, ported from the TypeScript listed under "Rules: where each goes". Also `rules.seed(tenant, items jsonb)` for the migration.
- **`ledger`**: per tenant, each item's ID, kind, state, tags, links, its field hashes and its cross payload (overlay records only), a sequence number per change for sync, tombstones, and every write's ID with its stored result so a repeated write gets the same answer.

The SQL lives in `cloud/items/` (`ledger.sql`, `rules.sql`, `README.md`, `tests/`), which `check_publishable.py` exempts like the rest of `cloud/`. It is applied the way `cloud/legal-commons/README.md` applies the pool's SQL.

Three edge functions in `cloud/legal-commons/supabase/functions/` (the project's one functions folder, so they share `_shared/pool.ts`), each with `verify_jwt = false` in `config.toml`:

| Function | Request | Response |
|---|---|---|
| `items-write` | `{tenant, write_id, store: "practice", tool, intent, ops: [op]}` | `{saved: true, ops: [{id, saved, as}], seq}` or `{saved: false, question}` |
| `items-sync` | `{tenant, store, since}` | `{items: [{id, kind, state, tags, links, deleted}], seq}` |
| `items-seed` | `{tenant, store, items: [...]}` | `{seeded, questions: [{id, question}]}` |

- Each checks the caller's key with `callerSecretKey`, then opens one Postgres connection with `SUPABASE_DB_URL` (the driver pinned to an exact version) and calls the `rules` function inside one transaction. PostgREST never reaches either schema.
- An `op` is `{op: "create"|"upsert"|"update"|"delete", id, kind, state?, tags?, links?, hashes, cross?}`. `upsert` lets the cloud match an existing item by the rulebook's natural key. `as` in the response names the item the op was saved to (its own ID for a new item, the matched item for an upsert), so the local side writes the op's `data` under that ID.
- A response never states a rule (Commandment 6). It says whether each op was saved, and when the write was refused, it asks one question about the item. A question may name item IDs as `{{item:<id>}}`. The tool fills in the item's local description before showing it, so the question reads as today's error does without the cloud ever holding the description. Examples: "Is this work part of the open to-do {{item:…}}, which already covers this filing?", "Which date is authoritative for {{item:…}}?", "Did the event move to a different date?"
- `items-seed` refuses a tenant that already holds items, so it runs once per tenant.

### What each write sends, and why none of it is User Data

Every op is built by one generic function. It sends:

- **Raw:** item IDs and the tenant ID (Cross Data: data IDs), `kind`, tags and state (vocabulary values, Metadata), links (IDs, Cross Data by decision 5), the tool name and its intent flags (`resolve`, `amend`, `occurred`, `action`).
- **Hashed:** every `data` field, each as HMAC-SHA256 of its canonical JSON value under `hash_key`. A null field is sent as null. The hash takes the value only, not the field name, so the cloud can compare an anchor's `anchor_date` with a source's `asserted_date`. This is Exception 2: the key never leaves the user's machine.
- **Cross:** only the rule overlay record, which the plugin creates, which is firm-wide, and which must hold no matter content. It is checked locally first (L3 below).
- **Never:** any `data` value in clear, `batch_tag` (resolved to IDs locally), and `hash_key`.

Before anything is sent, a local guard refuses any raw string that is not a vocabulary value (`^[a-z0-9][a-z0-9_:.-]*$`) or that matches the client matter-code pattern (`\bL\d{3,4}\b`, today in `rule-overlay.ts`). The refusal names the field and sends nothing.

| Tool | Ops | Raw beyond IDs and kind | Hashed |
|---|---|---|---|
| `upsert_client_matter` | upsert `client`, upsert `matter` | `billable`, matter state | every client and matter field |
| `insert_time_entry` | create `time_entry` | `matter` link, `billable` if given | entry_date, hours, description, batch_tag |
| `set_time_entries_billable` | update each entry (IDs resolved from `batch_tag` locally) | `billable` | none |
| `upsert_task`, `complete_task` | create or update `task` | links, `task_type`, state | description, dates, hours, nudge fields |
| `record_retainer_notice` | create `retainer_notice` | `matter` link | sent_at |
| `upsert_anchor` | upsert `anchor`, create `anchor_source` | links, `anchor_type`, intent flags | anchor_date, labels, source_document, source_excerpt, stated_date, asserted_date |
| `delete_anchor` | delete `anchor` (the cloud cascades) | none | none |
| `upsert_deadline` | create or update `deadline` | links, `deadline_type`, `source_type`, `review_flag`, state | every other field |
| `manage_payment_in_flight` (`record`, `clear`) | create or update `payment` | `matter` link, state | amount, dates, notes |
| `upsert_signal` | upsert `signal` | `matter` link, `signal_key`, state | note, confirmed_at |
| `set_status` | update `matter` | state | none |
| `ingest_court_calendar_year` | upsert `calendar_year`, delete that year's days, create new days | state, `status_category` | every data field |
| `import_invoices` | upsert one `invoice` per row that passes L1 | `matter` link | every invoice field |
| `upsert_rule_overlay` | upsert `rule_overlay` | `deadline_type`, `amending_reg`, state, cross = record | the record |

`firm_profile`, `upsert_firm_profile`, `config_status` and `config_set_root` touch files, not practice.db, and are unchanged.

### One write, step by step

1. The tool runs its interface checks (below) and builds its ops.
2. It stores the write under `pending` in practice.db. If practice.db cannot be written, the tool fails here and nothing is sent.
3. It posts the write to `items-write`.
4. On `saved: true`, in one local transaction it writes each saved op's `data` under its `as` ID, applies `items-sync` from the stored `sync_seq` (states, tags, links, tombstones for every changed item, including those the rules changed, such as superseded deadlines or re-marked sources), and removes the `pending` entry.
5. On `saved: false`, it removes the `pending` entry and returns the question as the tool's error. Nothing is written locally.
6. It returns the same shape as today, built from the local items.

If step 4 fails after the cloud saved, the `pending` entry stays. Every practice tool call first replays any `pending` write with its original `write_id`. The cloud returns the stored result, the tool applies it, and the result says it did so. `config_status` reports the number of pending writes.

### When the cloud cannot be reached

- **Unreachable, paused or misconfigured.** A write fails at step 3 with: "Probanda's Cloud did not answer (`<status or network error>`). Nothing was saved, in the cloud or in practice.db. If this persists, check whether the Supabase project is paused." The `pending` entry is removed because nothing reached the cloud. There is no queue and no retry loop, so a failure is never hidden.
- **No credential.** A write fails with the not-configured message, naming the commons `configure_credential` tool.
- **Reads** never call the cloud and keep working.
- A non-JSON reply or one without `saved` counts as unreachable, never as saved.

### Rules: where each goes

**To the cloud (`rules`)**, ported from the named code:

| | Rule | From |
|---|---|---|
| R1 | The eight lifecycle policies, the `set_status` check against signal states, and their seeding | `shared.ts` `DEFAULT_POLICIES`, `ensureDefaultPolicies`, `writes.ts` `set_status` |
| R2 | Each kind's vocabularies and state transitions (task, anchor, source, deadline, review flag, signal, coverage, calendar category, overlay status) | the CHECK constraints in `backend.ts`, the enums in `practice-registry.ts` |
| R3 | One open to-do per (matter, filing), and a filing link needs a matter | `writes.ts` `refuseSecondOpenTodo`, `upsert_task` |
| R4 | One anchor per (matter, anchor_type, party, proceeding). The conflict, resolve, amend and occurred rules, source identity, and re-marking | `writes.ts` `upsert_anchor`, `remarkSources` |
| R5 | Deadline supersession by its natural key. `practitioner_choice` needs a scenario label and a note. A `rule_stale` alternative cannot be resolved | `writes.ts` `upsert_deadline` |
| R6 | A time entry inherits its matter's `billable`. A non-billable matter takes no invoice | `writes.ts` `insert_time_entry`, `invoices.ts` |
| R7 | Invoice merge by (matter, invoice_number), and the purge of null-numbered rows | `invoices.ts` pass 2 |
| R8 | Deleting an anchor deletes its sources and deadlines | `writes.ts` `delete_anchor` |
| R9 | The rule overlay record contract (§6) | `rule-overlay.ts` `validateRuleOverlayRecord`, except the matter-code guard |
| R10 | A confirmed calendar year needs at least one day, and a year's days are replaced whole | `writes.ts` `ingest_court_calendar_year` |
| R11 | One signal per (matter, signal_key) | `writes.ts` `upsert_signal` |

**Kept local as Cross Data under Exception 3**, each because it works better on the user's machine:

- **L1. Billing cutoff and the invoice regression gate** (`effectiveCutoff`, `simulatePostImportRows`, the refusal of negative amounts and positive trust balances). Each orders or compares User Data values (dates, amounts), which keyed hashes cannot order. `wip_hours` and `ar_data` also need the cutoff offline.
- **L2. What each read returns by default** (`open_tasks` returns open to-dos, `active_deadlines` leaves out dismissed, met, notified and superseded rows, and `ar_data` and `wip_hours` leave out closed and non-billable work). Reads must work offline.
- **L3. The matter-code and vocabulary guard** on everything that leaves the machine. It must run before the send to keep Commandment 3.
- **L4. Matter references.** Normalizing `8575.L8443` to `L8443`, and finding a matter by `matt_num`, `file_number`, `client_num` or client name. These work on User Data.

**Interface checks stay in the tools** and are not rulebook: argument presence and type, mutually exclusive arguments (`resolve`, `amend` and `occurred`, `entry_ids` or `batch_tag`), ID formats (`filing_ref`, UUIDs), `nudge_interval_days >= 1`, and ISO date shape. They describe how to call the tool, not what an item may be. Open decision 1 asks Brahm to confirm the line.

### What leaves the plugin

From the data server source, and so from the bundle: `SCHEMA_SQL`, every `migrate_*` function and `PY_HELPER`'s table handling in `practice/backend.ts`, the whole of `practice-registry.ts`, `DEFAULT_POLICIES`, and the rule code R1 to R11. The legacy DDL moves (not copied) into the private migration script's test fixture under `scripts/`, which is never shipped, so `check_publishable.py --new-since` sees a move. The bundle loses every schema line that comes from `practice/backend.ts`.

### Tool shapes

All 32 `practice_data__*` names and their inputs stay. Outputs stay the same except:

- `read_signals` no longer returns `policies` (rulebook, Commandment 4). See open decision 2.
- `import_invoices` replaces `skipped_non_billable` with `not_saved` (a count) and `questions` (one per refused row). No skill reads `skipped_non_billable`. `invoice-tracking` reads `imported`, `skipped_no_matter` and `skipped_negative`, which stay.
- A refused write returns the cloud's question instead of today's rule-stating error. `task-prioritization` relays the refusal that names the open to-do, and the filled-in question still names it.
- `owner_id` disappears from every row. No caller reads it.
- `config_status` gains `cloud_credential` (`present` or `missing`) and `pending_writes`.

Skill and agent changes (step 8):

- **`matter-status-tracking`** stops computing the next status from `policies`. It proposes the status it judges right with `set_status` and relays the cloud's question if refused.
- **`practice-data/SKILL.md`**: Conventions says writes now need Probanda's Cloud and reads do not ("zero cloud calls" becomes "zero cloud calls on reads"). "auto-seeds the 8 default lifecycle policies" goes. The Consumer Contract's table column and the `practice_anchors`, `practice_deadlines` and `practice_anchor_sources` names become item kinds. The `python_timeout` advice extends to the pending-write replay.
- **Table and column names** become item and field wording in `task-prioritization`, `executive-assistant`, `wip-tracker`, `ar-follow-up`, `matter-status-tracking`, `file-review-prep`, `invoice-reviewing`, `time-entry-drafting`, `case-data/references/terminology-crosswalk.md` and `drafting-data/SKILL.md:132`. For example, "Reads from: `matters`, `clients`, `time_entries`" becomes "Reads matters, clients and time entries through `/practice-data`".
- `docket-clerk.md` and the `shared/docket-clerk/` references keep their field names (`review_flag='rule_stale'`), because those are tool fields, not columns.

## Migration of existing databases

The plugin runs only on Brahm's machines (Exception 4), and practice.db is one SharePoint-synced file under each machine's `case_data_root`, so there is normally one database. The migration is a private script, `scripts/migrate_practice_db.py`, run from this repo's checkout and never shipped. It holds the old table list, which is allowed because Brahm's machines count as Probanda's Cloud for Commandment 4 until the store leaves the list.

1. **Inventory.** On each machine, `config_status` (with `redirected_copies`) and a search of `case_data_root\_practice\` list every practice.db. Every file found is migrated or named as abandoned by Brahm.
2. **Freeze.** Brahm closes every session that uses practice data on every machine, and SharePoint shows the file synced.
3. **Snapshot before.** `scripts/practice_read_snapshot.mjs` starts the current released bundle against the file over stdio and records the output of every read tool: `matter_lookup` for every matter, `trust_summary` (all), `wip_hours`, `ar_data`, `open_tasks`, `active_deadlines` with every include flag, `time_entries_query` (all), `invoices_query`, `read_signals` per matter, `court_calendar_coverage`, `court_calendar_days`, `rule_overlay` and `manage_payment_in_flight` `query`.
4. **Convert.** The script reads every row of the 15 tables, checks that `practice_status_policies` holds exactly the eight defaults (otherwise it stops and lists the differences for Brahm), creates a new tenant ID and hash key, and writes `practice.new.db` in the item form. It then rebuilds every old row from its item with the generic flattening and compares field by field. Any difference stops the run.
5. **Seed.** It posts every item's metadata and hashes to `items-seed`. Each `questions` entry (existing data the rules would refuse, such as two open to-dos on one filing) is printed for Brahm and stays as it is: seeding records the data, it does not repair it. It then runs `items-sync` and checks that the cloud holds the same items with the same states, tags and links.
6. **Swap.** It renames `practice.db` to `practice.legacy-2026-10-DD.db` and `practice.new.db` to `practice.db`. An interruption before the swap leaves the original untouched.
7. **Snapshot after.** The same script runs the new bundle against the new file. Every output must equal the before snapshot, except the differences listed under "Tool shapes".
8. **Remove the legacy copy.** After every machine has run a write and a read on the new file, and Brahm says so, the legacy file goes to the recycle bin through `safe-file-deletion`. A legacy file holds the old DDL, so it must be gone before step 10.

## Steps

Each step ends with its check passing, a commit by pathspec and a push to `main`.

| Step | Work | Check that fails if the step is wrong |
|---|---|---|
| 1 | `cloud/items/ledger.sql` and `rules.sql` with R1 to R11 ported, the `seed` function, and `cloud/items/tests/` (scratch-schema script in the style of `build_scratch_test.mjs`, one case per behaviour that today's `practice-*.db.test.mjs` files assert, plus refusal cases). Applied to the project. | The scratch script passes. `select has_schema_privilege('anon','rules','USAGE')` and the same for `authenticated`, and for `ledger`, all return false. `pgrst.db_schemas` holds neither schema. |
| 2 | `items-write`, `items-sync` and `items-seed`, deployed. | `cloud/items/tools/check_items.mjs` runs a scripted sequence against a throwaway tenant: a saved write, a refused write with a question, a repeated `write_id` returning the stored result, a wrong key getting 401, and a response whose keys are only `saved`, `ops`, `seq` and `question`. It then deletes the tenant's rows. |
| 3 | The DPAPI store and credential path move from `commons-mcp/src/` into one shared source that both bundles compile. The data server reads the same credential file. | The commons tests pass unchanged. A new data-server unit test reads a credential through the existing env override. Both bundles build. |
| 4 | `src/kv/` is extracted from `time-pipeline/backend.ts` and used by it. | The time-pipeline tests pass unchanged. `check_publishable.py --new-since origin/main` reports nothing new. |
| 5 | The practice tools move onto items: the generic op builder with the L3 guard, the hash function, the cloud client with the pending-write replay, the generic flattening, the reads with L1, L2 and L4, the legacy-format refusal, `config_status`'s two fields. `SCHEMA_SQL`, the migrations, `practice-registry.ts`, `DEFAULT_POLICIES` and R1 to R11 are deleted. `practice-board.ts` and `render_practice_board` move onto the reads. | The practice tests are rewritten against a fake cloud. Read tests keep their expected outputs. Write tests assert the ops sent, that no clear `data` value and no `hash_key` appears in any request, that a refusal writes nothing locally, that an unreachable cloud writes nothing and says so, and that a pending write is replayed. A grep of `source/probanda/mcp/src/` for `CREATE TABLE` (any case), `practice_clients` and the other 14 table names finds nothing. `npm test` shows no failure that `main` does not already have. |
| 6 | `scripts/migrate_practice_db.py`, `scripts/practice_read_snapshot.mjs`, and tests in `scripts/tests/` with a legacy fixture that fills every table, including conflicted anchors, superseded sources, null invoice numbers, alternatives and an overlay record. | pytest: the fixture converts with zero round-trip differences, the item count per kind equals the row count per table, the run refuses an already-converted file, a run killed before the swap leaves the original byte-identical, and non-default policies stop the run. |
| 7 | Release: bump `version` in `source/probanda/plugin.json`, `python scripts/build_plugin.py`. Brahm syncs each machine. Then the migration on each database, with Brahm present for steps 2 and 8 of the migration. | `build_plugin.py --check`, `check_plugin.py`, `check_publishable.py --new-since origin/main` pass. The after snapshot equals the before snapshot except for the listed differences. On each machine an `upsert_task` and `complete_task` on a test to-do round-trip, and a write with the cloud URL overridden to an unreachable host fails with the message above while reads still answer. |
| 8 | The skill and agent prose changes listed under "Tool shapes". | A grep of `.claude/skills/` and `source/probanda/agents/` for the 15 table names, and for `matters\.`, `tasks table` and `deadlines table`, finds nothing. `check_layering.py`, `build_plugin.py --check` and `check_plugin.py` pass. |
| 9 | The legacy files are removed (migration step 8). | A search of each machine's `_practice` folder and redirected copies finds no file holding a `practice_` table. |
| 10 | Brahm edits `COMMANDMENTS.md` with the wording below. The session commits the file exactly as he left it. | `git diff` of `COMMANDMENTS.md` shows only that sentence changed. |

## Coordination with the five-plugin split

`docs/Plans/2026-10-13_four-plugin-split.md` phase 5 is a single cutover commit, prepared on branch `cutover` in `../probanda-cutover`, which moves `source/probanda/mcp/` to `source/practice/mcp/`, renames `plugin_probanda_data__` to `plugin_practice_data__`, rebuilds the data bundle and adds the `file-admin` `files` bundle. It waits for Brahm's word, and its step 0 already merges whatever `main` has added since.

Recommendation: build this plan on `main` now, without waiting for the cutover.

- Steps 1 and 2 (cloud) touch nothing the cutover moves.
- Steps 3 to 6 change files the cutover moves or renames inside (`practice/`, `tools/practice/`, `time-pipeline/`, `schema-gen.ts`, the tests, the bundle). Git follows the moves when the cutover merges `main`. This plan adds no tool name, so the cutover's rename list does not grow.
- Whichever lands second rebuilds the data bundle. The cutover's count of 49 problem lines in the bundle drops by the lines removed here, so the cutover session re-counts instead of using 49.
- The `files` bundle must not pull in the cloud client: after the cutover, a search of `dist/file-admin-mcp.js` for `items-write` finds nothing. `housekeeping/resolve.ts` imports `resolveCaseDataRoot` from `practice/backend.ts`, so that function stays free of cloud imports.
- After the cutover, `practice` needs the commons credential while only `research` ships the tool that sets it. Open decision 3 covers this.
- Before pushing steps 5 or 8, check that no cutover merge is in progress (the split plan's status line and `git log origin/main`).

## Open decisions for Brahm

Each has a default the executing session takes if he says nothing before the step that uses it.

1. **Where interface checks end and rules begin (step 5).** This plan keeps argument presence and type, mutually exclusive arguments, ID formats, `nudge_interval_days >= 1` and ISO date shape in the tools, and sends everything else to `rules`. Recommendation: accept. These checks say how to call a tool, the caller needs them to call it at all, and moving them would cost a cloud call for a typo.
2. **Status policies (steps 5 and 8).** `read_signals` stops returning `policies`, and `matter-status-tracking` proposes a status and relays the cloud's question when refused, instead of computing the next status itself. The alternative is a read endpoint that lists the statuses a matter may move to, which comes close to stating a rule (Commandment 6). Recommendation: the first.
3. **Setting the credential after the split.** Today one plugin ships both servers. After the cutover, `practice` writes need a credential that only `research`'s `legal_commons__configure_credential` can set. Recommendation: at the cutover, give the data server a tool that writes the same credential file (still one credential), so `practice` works alone. Until then nothing changes.
4. **Tenant identity.** The credential is one shared secret key with no user identity, so a random tenant ID in practice.db separates one practice's ledger from another's. Anyone holding the key and a tenant ID could read that tenant's states and links, never its data. Recommendation: accept while Brahm is the only user, and give each user their own credential before a second practice uses this.
5. **Rule prose in skills and tool descriptions.** `practice-data/SKILL.md` and the tool descriptions in `schema-gen.ts` state rules that the cloud now enforces (the supersession key, one open to-do per filing). This plan changes only table and column names and statements that become false. Recommendation: leave the rest. Exception 4 limits local databases to the store list, but the Development Plugin may still hold Trade Secrets on Probanda's machines, and the callers need the guidance. Moving it out is the Published Plugin's job.
6. **Tool input enums.** The input schemas list vocabularies (`task_type`, statuses, review flags). Recommendation: keep them as Cross Data, since the plugin must send valid vocabulary values. The transitions between them move to `rules`.

## Wording for COMMANDMENTS.md (step 10, Brahm only)

In Exception 4, replace:

```text
For local databases, this exception covers only these legacy stores: case-data, drafting-data, timecamping-data and practice-data.
```

with:

```text
For local databases, this exception covers only these legacy stores: case-data, drafting-data and timecamping-data.
```

## Risks

- **Writes need the cloud.** With the project paused or the network down, no practice write lands. Every failure says so and reads keep working. The free plan pauses a project after a week without activity. The commons tools and daily writes keep it active.
- **The rulebook port.** R4 and R5 are the most intricate rules in the plugin. Step 1's scratch tests port every behaviour the current tests assert, and the before and after snapshots in step 7 catch any read-side drift.
- **The shared key.** The `rules` schema is protected by not being exposed, not by the key, because every user holds the project's secret key (decision 2 and open decision 4).
- **SharePoint.** Two machines writing practice.db at once is an existing risk that this plan does not change. The `pending` namespace lives in the same file, so a write that is not applied locally is visible from every machine.
