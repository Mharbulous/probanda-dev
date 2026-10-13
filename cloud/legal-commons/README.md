# legal-commons database

DDL of record for the **layer-3 legal-commons pool** — the matter-free shared
knowledge pool served by this plugin's `legal_commons__*` MCP surface. Deployed as
a dedicated `legal_commons` Postgres schema in the Supabase project.

Apply to a fresh Supabase project in order:

1. `schema.sql` — the six pooled tables (`principle`, `principle_redirects`,
   `authority`, `principle_authority`, `criterion`, `treatment`), their indexes,
   and the `pg_trgm` extension for trigram retrieval.
2. `functions.sql` — the six RPCs the runtime binds to, plus the schema-exposure
   and `service_role` grant steps at the bottom.
3. `rule_periods.sql` — the court-rule period tables (`rule_period`,
   `rule_period_verification`), their four RPCs and their grants, behind the
   `legal_commons__rule_period_*` tools.

All three files are idempotent and safe to re-run.

## Troubleshooting store (separate project)

`troubleshoot.sql` is **not** part of the pool. It creates the `troubleshoot`
schema behind the `troubleshoot__*` tools (generic tooling fixes, no client or
matter content) and is applied only to the separate troubleshooting Supabase
project, in its SQL editor. **Nothing in it may be applied to the pool project**,
and nothing above belongs in the troubleshooting project. Setup steps:
`../../SETUP.md` § "Troubleshooting store (optional)".

## Currency

The `treatment` table, `principle_authority.treatment` /
`treated_by_authority_id`, and `authority.last_verified_at` are the currency
columns. They are written by `record_treatment` (an RPC, because it spans the
treating authority row and the treatment edge in one transaction),
`push_principle`, and the `stamp_verified` tool. Every one of them is bare
`text`/`timestamptz` — **there is no CHECK constraint on any treatment value**, so
the vocabulary is enforced in the runtime (`../src/legal-commons/tools.ts`,
`TREATMENT_VALUES` / `EDGE_TREATMENT_VALUES`) and documented for callers in
`.claude/skills/legal-commons/SKILL.md` § "Currency — treatments, not rewrites".
The two sets differ by tense on purpose and are not interchangeable. A migration
adding a value must change the runtime constant, not this schema.

## Severance

There is **no matter table in this namespace, by construction** — `REFERENCES
matters(...)` is unrepresentable here. Layer-3 is matter-free; matter data lives in
the local SQLite databases behind `/case-data` and `/practice-data` and is reached
only through those gatekeepers. Nothing in this directory should ever acquire a
matter-scoped table, a `matter_id` column, or a per-user key table.

## Scope of these files

`schema.sql` + `functions.sql` cover the tables and the RPC surface. They are not
the complete tool surface: `browse` and the `amend_*` / `link_*` / `unlink_*` /
`merge_*` tools operate directly on the tables through PostgREST and define no
function. Table and column names are therefore load-bearing for more tools than
`functions.sql` alone suggests.

## Provenance and staleness

Both files were recovered on 2026-07-18 from `3bdd492^:planning/3. Staging/` after
being deleted in a staging tidy-up on 2026-07-14. They have been verified against
the live runtime source in `../src/legal-commons/` (table names and RPC names
match), but **not** diffed against the deployed pool, which has taken content since
2026-07-13. Confirm against the live pool before relying on these for a migration.

Read the provenance block at the top of each file before treating it as current.

## History

This path previously held a byte-identical carryover of the retired pre-B5
case-data schema — 22 matter-scoped tables plus `practice_*` tables, `_enc`/`_iv`
encryption columns, and a `user_keys` keystore, none of which exist in this pool.
It was dead from the moment the plugin was renamed (`090fc64`) and was deleted on
2026-07-18. Do not reintroduce it; if you need it, it is in git history.
