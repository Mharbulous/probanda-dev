# Operation: query

Read [`../shared/conventions.md`](../shared/conventions.md) first — every call passes `matter_root` per §2.2; halt on any tool error.

**This operation is read-only with respect to case data.** It never mutates any table — the one `matter_data__execute` call it makes (§1 below) only ensures the reporting views exist, idempotent DDL with no data effect. It never reads `evidence.sql`; live state comes only from `matter_data__query`.

## 1. Ensure the reporting views exist — idempotent, every run

Read [`../references/queries.sql`](../references/queries.sql) as §1 of `../shared/conventions.md` directs. Isolate the VIEWS section (everything before the first `-- CANONICAL QUERIES` marker comment) and pass it as `sql_script` to `matter_data__execute`, with `matter_root` (§2.2). This runs on **every** invocation of `query`. Two views are `CREATE VIEW IF NOT EXISTS`, so re-running them against a database that already has them is a no-op. `v_fact_status` is dropped and created each time, so its bare-row exclusion (#67) reaches a database whose view predates it. It guarantees the views exist even against a freshly-rebuilt or freshly-migrated database. `matter_data__execute` regenerates `evidence.sql` as a side effect of this call even though nothing changed — harmless, since the view definitions it captures are already idempotent.

Do not split the VIEWS section into individual statements before sending it: splitting on `;` leaves each statement's *preceding* comment block attached to the front of the next chunk, so a naive `startswith('CREATE VIEW')` filter matches nothing. Send the whole section as one `sql_script` — SQL comments are valid statement separators inside it.

**Read-only callers:** a caller whose grant includes `matter_data__query` but not `matter_data__execute` (see [`../references/design-decisions.md`](../references/design-decisions.md) #21) skips §1 entirely and proceeds to §2. If a named query then fails on a missing view, report the missing view as the cause and stop — never attempt to create it.

## 2. Run the query

The named queries live in [`../references/queries.sql`](../references/queries.sql), each marked with a stable `@query_NN_name` comment. IDs run 01–30 (plus `05a`/`05b`/`05c`) with intentional historical gaps at 07 and 11 (removed queries; the gaps are kept so IDs stay stable across schema versions — do not renumber). Parameterized queries:

| IDs | Parameter |
|---|---|
| 03, 16 | `coa_id` |
| 09a, 09b | `fact_id` |
| 13, 14 | `concept_id` |
| 15 | `criterion_id` |
| 18, 19 | `authority_id` |
| 23 | `proceeding_id` |
| 24 | `proceeding_id` (NULL selects no-proceeding instructions), `status` |
| 25 | `proceeding_id`, `admitting_party_id` |
| 30 | `citation` (`''` for none), `title` fragment (`''` for none) |

**02 and 25 both concern admissions and answer different questions — do not
substitute one for the other.** `02` is a fact-level test over the whole party
roster: *is this fact uncontested* (admitted by at least one party, contradicted
by none). `25` is per-party: *has this named party admitted this fact*, which is
what a proof route needs when something must be proven against every party it is
sought against. Answering a per-party question with `02` would pass a fact
against a co-party who never admitted it.

Resolve the user's request to either:

- a **named query ID** — locate its SQL by the `@query_NN_name` marker in `queries.sql`, bind the required parameter(s) via `matter_data__query`'s `params`; or
- **validated read-only ad-hoc SQL** — the agent may compose ad-hoc SQL for an analytical question that doesn't map to a named query, provided it first reads [`../references/schema.sql`](../references/schema.sql) for the current table/column names (never guess them) and validates the statement is read-only (a single `SELECT`/`WITH` statement — reject anything containing `INSERT`, `UPDATE`, `DELETE`, `ATTACH`, `PRAGMA` writes, `CREATE`, `DROP`, or a trailing statement after a semicolon) before calling `matter_data__query`. (`matter_data__query` itself also rejects any statement that isn't `SELECT`/`WITH`/`PRAGMA` — this client-side check exists to fail with a clearer, query-specific message.)

  **Pending privilege review (v8.7).** An ad-hoc read that serves drafting, an evidence list, or production must exclude facts, positions and evidence links from a source whose `privilege_status = 'pending'` — for example `AND NOT EXISTS (SELECT 1 FROM sources ps WHERE ps.source_id = f.source_id AND ps.privilege_status = 'pending')`, keeping facts whose `source_id` is NULL. The views and the drafting named queries already do this ([`../references/design-decisions.md`](../references/design-decisions.md) #49).

  **Bare rows (#67).** A `main.facts` row with `description = ''` is a Fact known only from a privileged source. The same ad-hoc read must add `AND f.description <> ''`. Never read a bare row's meaning into a draft, list, book or page: only `@query_10` and `@query_22` show it, to the practitioner, by reading `privileged.fact_provenance`.

**Never mutate. Never read `evidence.sql`.**

## 3. Format results

Format every result row with:

- **computed citations** wherever a row carries `source_id` + `source_locator` (or `file_path` + a locator column directly) — per the citation format in [`../shared/conventions.md`](../shared/conventions.md): `<sources.file_path>#<source_locator>`;
- the **posture legend** whenever a `posture` column appears in the output (from `v_fact_status` or any ad-hoc query selecting it):

  | Posture | Meaning |
  |---|---|
  | `disputed` | at least one party denies it |
  | `admitted` | at least one party expressly admits it and none deny or decline to admit |
  | `not_admitted` | at least one party expressly declines to admit it |
  | `no_position` | a party expressly abstains from taking a position |
  | `claimed` | asserted, no response yet |
  | `unaddressed` | no current position rows exist |

When the answer tells the practitioner what a tribunal, court, counsel, a party or a witness said or wrote, a fact's description is an extraction, not the source's words: quote the source at the cited locator before any summary, per [`../../shared/report-what-a-source-said.md`](../../shared/report-what-a-source-said.md).

## 4. No data mutation

This operation never mutates any table (the one `matter_data__execute` call in §1 only ensures the reporting views exist — idempotent DDL, not a data write). Report results and stop.
