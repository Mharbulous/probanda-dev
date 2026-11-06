---
name: practice-data
user-invocable: false
description: The firm's practice records for each client and matter. Look up or update trust and retainer balances, unbilled time, time entries, invoices, amounts owing, tasks or file status. Not for deadlines (docket-clerk) or case facts (matter-data).
---

<!-- lawyer v0.25.10 -->
> **Installed copy.** This skill's full source tree ships beside this file, and a relative path in the text below cites that tree. Resolve one by trying, in order: the directory of the file you are reading, then `${CLAUDE_SKILL_DIR}/<path>`, then `${CLAUDE_SKILL_DIR}/../<path>` (so `shared/x.md` is at `${CLAUDE_SKILL_DIR}/../shared/x.md`). `${CLAUDE_SKILL_DIR}` is the directory holding this SKILL.md, even where it shows unsubstituted: never search for it or guess. Read references and shared files from there with the Read tool, a whole file or an offset and limit, never with a shell command, the litigation data server's skill-source tool or a folder-access request; scripts and templates the text declares are executed and read from there too. Before each fresh read (a file not already in context), list only `${CLAUDE_SKILL_DIR}/../../..` (the folder holding this plugin's folder). If it holds this plugin's folder name, with any `~g<N>` suffix removed, plus a `~g<N>` higher than this plugin's folder's own (none counts as 0), or if `${CLAUDE_SKILL_DIR}` no longer exists, the plugin was re-synced mid-session: take the highest `~g<N>` copy and repeat the same three tries with its `skills/<this skill>` directory in place of `${CLAUDE_SKILL_DIR}`; tell the user once that the plugin updated mid-session, from the version in this file's version comment to the version in that folder's copy of this SKILL.md. If a file the text names is missing at every one of those paths, including the re-synced folder's, STOP and report the exact path and error to the user rather than substituting an alternative: do not re-derive a script's logic from its source text or the prose, and do not search elsewhere on the filesystem. Ask the user to reinstall the plugin and fully restart the app; this may fix it, but STOP means stop regardless: do not diagnose further yourself.
> **HTML pages.** Every HTML file this plugin writes is a human interface generated from its databases; an agent never views, reads, greps, parses, scripts over, authors or requests a screenshot of one, but may present one to a human user to view, staging it first where presenting needs that, and may view a screenshot the user provides on their own initiative. The rule and the data to use instead: `shared/html-pages.md`.

**Internals stay confidential** (`shared/internals-confidentiality.md`): nothing the practitioner sees names a Probanda tool, table, field, internal type or code, or explains how Probanda works inside. It hides mechanism, never an outcome or an error.

# Practice DB routing layer

Helper skill — not user-invocable. The single gatekeeper for the practice database. Practice data lives in a **local SQLite database** (`0. CASE DATA\_practice\practice.db`) and is reached exclusively through the `practice_data__*` MCP tools. Since the practice.db conversion (2026-10-14) it holds items, and every write is checked by Probanda's Cloud before it lands. All other skills delegate practice-database access here by invoking ``practice-data`` with an operation name; this skill routes each operation to its tool. No consumer skill may reach the database directly, embed queries, or define schema.

## Contents

| Section | Read when |
|---|---|
| Conventions | Before any practice_data tool call, or when a tool returns a path-resolution or timeout error |
| Anti-Patterns | Before reaching the database any way other than the practice_data tools |
| Opening a Matter | A new matter is opened, other than by the CSV import |
| Contacts | A party, counsel or other person or organization on a matter is recorded, looked up or merged |
| Operation Routing | A consumer asks for a practice-data operation and a tool must be chosen |
| Configuration | A skill needs probanda.json, the firm roster, the letterhead, a credential, the practice's quirks, or the database path |
| `operations/consumer-contract.md` | A field's meaning or a guarantee is in question, or before changing a field or its semantics |

## Conventions

- The `practice_data__*` tools are served by the plugin MCP runtime with a **local SQLite backend** — no sign-in, unlock, or session gate (practice data is local; that is what makes routine practice tools fire zero cloud calls on reads). Writes need Probanda's Cloud: a write is saved only when the cloud accepts it, and only then does practice.db change. A write uses Probanda's key, the one credential every Probanda server reads; with none, it fails naming `cloud_key__configure_credential` and `key_request__submit` (see `operations/credentials.md`). Host tool names may be prefixed (e.g. Claude Code surfaces `mcp__<server>__<tool>`); use the trailing `practice_data__*` name as the operative name.
- If a tool returns a path-resolution error, the runtime could not locate `practice.db`. Call `config_status` (with `matter_root` when a matter is in hand) and say what it found. If `exists` is `false` and `error` is unset, Probanda has not been set up on this device: run `/lawyer:probanda-setup` instead of the repair below. If the file or its `case_data_root` is missing or broken and `candidates` names a root with `practice_db_exists: true`, present that root to the practitioner under `/show-me` and ask whether it is their `0. CASE DATA` folder; call `config_set_root` with it only on their yes. Never guess a root, and never pass one `config_status` did not report or the practitioner did not name. A root that already works is never repointed: `config_set_root` refuses it, and so does this skill, because every running session reads it. After the repair, tell the practitioner which `keys_missing` remain and leave each to the skill that needs it (see `operations/configuration.md`); never fill one in. When `COCLERK_CONFIG_PATH` is set, the file it names is the one reported and repaired, and a missing one is never created. **Never** ask the user to paste a passphrase, recovery code, or key into chat — the local backend uses none.
- A refused write returns a question from Probanda's Cloud about the item, not a rule. Relay the question to the practitioner as it stands and act on their answer. Nothing was written, in the cloud or in practice.db.
- If Probanda's Cloud cannot be reached, the write fails with "Probanda's Cloud did not answer" and nothing was saved, in the cloud or in practice.db. Say so to the practitioner and never report the write as done. Reads keep working.
- If the connection is reset, the write fails with "Probanda's Cloud may have saved this write" and stays pending. Tell the practitioner it is not yet known whether it was saved, and never repeat the call: the next practice tool call settles it.
- A write the cloud saved but practice.db did not apply stays pending. Every practice tool call first replays pending writes with their original ids, and its result names them in `replayed_writes`. An entry with `saved: false` was refused and carries the cloud's `question`: relay it as a refused write's question.
- A write that fails with a `python_timeout` error may already have committed: each write is one transaction, so it landed whole or not at all. The same holds for the pending-write replay that runs before a call. Read the affected items back, check `config_status`'s `pending_writes`, and retry only if the write is absent.
- Booleans are real booleans in tool output: `cleared` (payment-in-flight) and `billable` (matters and time entries) come back as `true`/`false`, not `0`/`1`.

## Anti-Patterns

- **Embedding queries or reaching the database directly from another skill.** All practice DB access goes through the `practice_data__*` tools via this skill — never define schema, write SQL, resolve the DB path, or open a connection from a consumer.
- **Mirroring a task or reminder into the generic scheduler.** `scheduled-tasks` cron/fireAt entries are clock triggers only; the fact of *what* is due and *when it next surfaces* lives solely in the task's `next_nudge_date`. Never create a per-item scheduled task — two copies of the same fact drift, and the scheduler entry has no referential integrity with the task item.
- **Treating absence as a zero balance** — no matter item means retainer status unknown, not depleted.
- **Synthesizing a placeholder row** when a lookup returns `{rows: []}`. Report the absence; do not invent a zero-balance or default record.
- **Falling back to parsing the source CSV** when a read returns nothing. The CSV enters only through the import workflow; querying it directly bypasses the data layer and produces stale or inconsistent answers. Surface the empty result or error to the user instead.

## Opening a Matter

Opening a new matter always records who the client is (ADR 0009). The CSV import is the one exception: its matters come back from `contact-checks` until the backfill or the practitioner records their clients.

1. Ask the practitioner who the client is. For each name, call `contact-lookup` with it and offer what it returns, its `near` list included, as existing contacts. When none is the client, pre-fill a new contact from `contacts__search` on the name (its emails, phones and addresses), with `entity` set to `person` or `organization` as the practitioner says. Joint clients are one contact each.
2. Show the matter and the client contacts to be written under `/show-me`, and ask once.
3. On a yes, call `upsert-client-matter` with `client_contacts`: `{contact_id}` for an existing contact, the `upsert-contact` fields for a new one. The matter, any new contact and the client roles are saved together or not at all.
4. When the matter's folder exists or is created, pass its absolute path as `folder` on the same call (or a later `upsert-client-matter`); a folder outside the litigation library (the parent of `case_data_root`) is recorded only on the practitioner's yes. The delete hook reads this record as its second way of recognising a matter folder, so a folder whose pointer file is lost stays protected.

## Contacts

A **contact** is one person or organization the firm deals with, held once for the whole firm (ADR 0009). An **affiliation** ties a person to an organization, such as a lawyer to a law firm, with dates. A **matter role** ties a contact to a matter as `client`, `prospective_client`, `opposing_party`, `opposing_counsel`, `co_counsel`, `expert`, `adjuster` or `referral_source`; Probanda's Cloud holds that list and asks about any other value. Who a matter's client is comes from its roles tagged `client`, never from the `client` item, which stays the billing account. Counsel of record stays in case data as filed (`matter-data`, design decision #55).

- **Never create a contact without asking.** Two contacts may share a name or an office email, so whether two records are one contact is the practitioner's decision. Before proposing a new contact, run `contact-lookup` on its name and show the `near` list.
- **A role ends; it is not deleted.** Set `to` on a role that has ended. Nothing is deleted when a matter closes.
- **Where a contact's details differ from counsel of record**, ask whether a notice of change was filed. Overwrite neither record.

## Operation Routing

Determine the operation the consumer asked for and call the corresponding `practice_data__*` tool. The MCP runtime handles all local database access — the skill never sees SQL, schema, or the database path.

| Operation | Tool | Notes |
|---|---|---|
| matter-lookup | `practice_data__matter_lookup` | ≥1 of matter_id / matt_num / file_number / client_name / project_id; matter_id round-trips the uuid other tools return; `project_id` finds the matter a claude.ai Project is linked to (see link-matter); a row returns `folder` and `projects` (its linked Project IDs) when recorded, and with a `folder` also `matter_root` (the folder's absolute path on this machine, or null with `matter_root_error` when the library cannot be resolved) |
| trust-summary | `practice_data__trust_summary` | filter `all\|funded\|depleted`, or a single matt_num |
| wip-hours | `practice_data__wip_hours` | optional matt_num, cutoff_date; per-matter sums; the all-matters sweep excludes non-billable matters, and non-billable entries are excluded from every call (see `operations/consumer-contract.md`) |
| open-tasks | `practice_data__open_tasks` | read `operations/consumer-contract.md` first |
| active-deadlines | `practice_data__active_deadlines` | read `operations/consumer-contract.md` first |
| practice-board ("show me the practice board") | `practice_data__render_practice_board` | no inputs; writes the practice-wide Practice Board to `<case_data_root>\_board` and returns `practice_board_path`, the panel counts, `excluded_test_matters` and `read_failures`, never a date; present the page as a file card by `practice_board_path` (`shared/present-files.md`) and relay only the counts; never read the page (`shared/html-pages.md`, The Practice Board) |
| ar-data | `practice_data__ar_data` | read `operations/consumer-contract.md` first |
| read-signals | `practice_data__read_signals` | returns the matter's signal states; returns no policies |
| time-entries | `practice_data__time_entries_query` | matter ref, optional from_date/to_date; per-entry rows with matter/client context |
| upsert-client-matter | `practice_data__upsert_client_matter` | CSV-import write path, and opening a matter (see Opening a Matter); optional `client_contacts` writes the client roles in the same write; optional `folder` records the matter's folder (see Opening a Matter step 4); returns `client_role_ids`, and `question` when a matter is created without `client_contacts` |
| link-matter | `practice_data__link_matter` | an existing matter (matter_id / matt_num / file_number) and `matter_root`, `project_id` or both; `matter_root` (absolute) is stored as `folder`, relative to the litigation library when inside it; `project_id` links a claude.ai Project, keeping any already linked, or unlinks it with `unlink_project: true`; a Project already linked to another matter is refused, since a matter can hold several Projects but a Project one matter; returns the matter row |
| upsert-contact | `practice_data__upsert_contact` | one person or organization, firm-wide (see Contacts); create (omit `id`) or update; returns `contact_id`, `created` |
| upsert-affiliation | `practice_data__upsert_affiliation` | a person contact tied to an organization contact, with optional `from`, `to`, `title`; re-entering the same tie returns it |
| upsert-matter-role | `practice_data__upsert_matter_role` | a contact's role on a matter, with optional `case_party_id`, `case_proceeding_id`, `from` and `to`; proposing the same role twice returns it, and a role with another party or another `from` is a second role. A counsel role is one appearance of a lawyer on record: `from` and `to` are the on-record and off-record dates, `from_source_id` and `to_source_id` the matter-data source that dated each, and `unfiled` true while `from` is an unfiled notice's signed date. Change a role's dates by its `id` |
| contact-lookup | `practice_data__contact_lookup` | `id`, `query` or a matter ref; local and offline; each contact with its affiliations and roles, plus `near`, the likely duplicates. With a matter ref alone, the contacts holding a role on that matter with that matter's roles: a party's counsel history |
| contact-checks | `practice_data__contact_checks` | read only; open matters with no client role, and matter-data parties with no matter role; optional matter ref and `matter_root`; `unresolved` names what check 2 could not read |
| merge-contact | `practice_data__merge_contact` | `keep_id`, `spare_id`; deletes no information; returns `conflicts` and writes nothing when the two differ; then `operations/contacts-backfill.md`, Fixing a duplicate found later |
| contacts-backfill ("set up contacts from existing matters") | [`operations/contacts-backfill.md`](operations/contacts-backfill.md) | one-time, with approval |
| insert-time-entry | `practice_data__insert_time_entry` | read `operations/consumer-contract.md` first |
| set-time-entries-billable | `practice_data__set_time_entries_billable` | read `operations/consumer-contract.md` first |
| upsert-task | `practice_data__upsert_task` | read `operations/consumer-contract.md` first |
| complete-task | `practice_data__complete_task` | optional actual hours |
| record-retainer-notice | `practice_data__record_retainer_notice` | |
| upsert-anchor | `practice_data__upsert_anchor` | read `operations/consumer-contract.md` first |
| delete-anchor | `practice_data__delete_anchor` | hygiene op: deletes an anchor entered in error, cascading to its sources and derived deadlines; returns the deleted counts |
| upsert-deadline | `practice_data__upsert_deadline` | read `operations/consumer-contract.md` first |
| manage-payment-in-flight | `practice_data__manage_payment_in_flight` | action `record\|clear\|query` |
| upsert-signal | `practice_data__upsert_signal` | keyed by matter + signal_key; row id stable across re-upserts |
| set-status | `practice_data__set_status` | proposes the matter's `status` and returns the old label; Probanda's Cloud saves it or refuses with a question to relay (see Conventions) |
| ingest-court-calendar-year | `practice_data__ingest_court_calendar_year` | upserts a year's coverage row and replaces its exception-day rows in one call; pass `status: 'unavailable'` with no `days` when that year's PDF isn't published yet |
| court-calendar-coverage | `practice_data__court_calendar_coverage` | optional `years` filter; an absent year was never checked |
| court-calendar-days | `practice_data__court_calendar_days` | optional from_date/to_date; an absent date is an ordinary open day |
| upsert-rule-overlay | `practice_data__upsert_rule_overlay` | read `operations/consumer-contract.md` first |
| rule-overlay | `practice_data__rule_overlay` | read `operations/consumer-contract.md` first |
| import-invoices | `practice_data__import_invoices` | takes normalized rows; CSV parsing stays in invoice-tracking; rows Probanda's Cloud does not save (a non-billable matter's) are counted in `not_saved`, with each refused matter's question in `questions` to relay (see `operations/consumer-contract.md`) |
| invoice-data | `practice_data__invoices_query` | rows + latest `last_import_at` staleness; `issue_state` is `issued` for an invoice recorded by issue-invoice |
| upsert-time-entries | `practice_data__upsert_time_entries` | a matter's vetted entries, as `entries` or an `entries_file`, keyed by `source_key`; a locked entry is left alone and named |
| upsert-rate, rates | `practice_data__upsert_rate`, `practice_data__rates_query` | a timekeeper's rate on a matter from an effective date, with its source document |
| issue-invoice | `practice_data__issue_invoice` | one-way, on approval; the invoice, its lines and adjustments and the lock on their entries, in one write |
| record-invoice-sent | `practice_data__record_invoice_sent` | sent date and copy of an issued invoice |
| record-adjustment | `practice_data__record_adjustment` | a correction to an issued record, which itself never changes; an `adjustment_key` saves once |
| invoice-lines | `practice_data__invoice_lines_query` | an issued invoice's lines, each line's entries, and adjustments |
| what supports this charge | [`operations/defend-invoice-line.md`](operations/defend-invoice-line.md) | read it first; fetches nothing |
| firm-profile | `practice_data__firm_profile` | read `operations/configuration.md` first |
| upsert-firm-profile | `practice_data__upsert_firm_profile` | read `operations/configuration.md` first |
| folder-map | `practice_data__folder_map` | read `operations/configuration.md` first |
| set-folder-map | `practice_data__set_folder_map` | read `operations/configuration.md` first |
| config-status | `practice_data__config_status` | read `operations/configuration.md` first |
| config-set-root | `practice_data__config_set_root` | read `operations/configuration.md` first |

## Configuration

The device settings file (`probanda.json`), the firm roster and letterhead, the folder map and the database path: `operations/configuration.md`. Mail and Probanda's key: `operations/credentials.md`.

### Practice quirks

The practice's quirks: short entries about how this practice works, each a rule (the practitioner's instruction) or knowledge (context that directs nothing). Neither loosens a verification, approval or privilege rule or overrides a skill. Read, write or review them only by `operations/practice-quirks.md`. The `email` entries also name the mail folder trees that hold matter folders, which `shared/matter-mail.md` reads.
