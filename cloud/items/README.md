# Practice items in Probanda's Cloud

The rulebook and ledger behind practice-data writes, from
`docs/Plans/2026-10-14_practice-db-conversion.md`. Two private Postgres schemas in
the Supabase project `nbzkuhgiqscjkypedqff`:

- `ledger.sql`: schema `ledger`. Per tenant, each item's id, kind, state, tags,
  links, keyed field hashes and (rule overlay records only) its cross record; a
  change sequence number for sync; tombstones; and every write's `write_id` with
  its stored result. No data value is ever held in clear.
- `rules.sql`: schema `rules`. The vocabularies, state transitions, eight
  lifecycle policies and natural keys, a function per kind, and three entry
  points:
  - `rules.apply_write(tenant, write)` checks and applies one write, all or
    nothing. It returns `{saved: true, ops: [{id, saved, as}], seq}` or
    `{saved: false, question}`. An op's `saved` is false when the rules matched it
    to an existing item and stored none of its data (an anchor whose date stands,
    a source already recorded); `as` names that item.
  - `rules.sync(tenant, store, since)` returns every item changed after `since`.
  - `rules.seed(tenant, store, items)` records a tenant's existing items once,
    and asks a question about each one the checks would refuse.

Apply to the project in order, `ledger.sql` then `rules.sql`, the way
`../legal-commons/README.md` applies the pool's SQL. Both files are idempotent and
safe to re-run.

Neither schema is exposed through the API, and both grant nothing to `public`,
`anon` or `authenticated`. Only edge functions, connecting as `postgres`, call
the functions.

## Testing

```
node tests/build_scratch_test.mjs <output.sql>
supabase db query --linked --project-ref nbzkuhgiqscjkypedqff -f <output.sql>
```

The first writes one script that, in one transaction, applies both files twice
under scratch schema names (`items_scratch_ledger`, `items_scratch_rules`), runs
`tests/scratch_test.template.sql`, drops the scratch schemas, and returns one row
per test. Every row should have `pass` true.

## Edge functions

Three functions in `../legal-commons/supabase/functions/` call the entry points,
each with `verify_jwt = false` in that folder's `config.toml`:

| Function | Request | Calls |
|---|---|---|
| `items-write` | `{tenant, write_id, store, tool, intent, ops}` | `rules.apply_write(tenant, body minus tenant)` |
| `items-sync` | `{tenant, store, since}` | `rules.sync` |
| `items-seed` | `{tenant, store, items}` | `rules.seed` |

Each checks the caller's `apikey` against the project's secret keys
(`_shared/caller.ts`), then runs one `rules` function in one transaction over a
direct Postgres connection (`_shared/items.ts`, `SUPABASE_DB_URL`) and replies
with its jsonb unchanged. They import `caller.ts`, never `pool.ts`, so they do
not load the embedding model.

- A wrong or missing key gets 401.
- A body that is not a JSON object gets `{saved: false, question}` with status
  200, like every other refusal. A tenant that is missing or not a UUID is
  passed to `rules` as null, which answers it; `items-sync` answers it itself,
  because `rules.sync` would return an empty list.
- A database fault gets 500 and a generic body, never the SQL error text. It
  logs its SQLSTATE only. Nothing logs a request body.

Deploy them by name, from the repo root:

```
supabase functions deploy items-write items-sync items-seed --use-api --project-ref nbzkuhgiqscjkypedqff --workdir cloud/legal-commons
```

## Checking the deployed functions

```
node cloud/items/tools/check_items.mjs [--workdir <dir>]
```

It runs a scripted sequence against two fresh random tenants: a saved write, a
refused write with a question, repeated `write_id`s returning the stored result
byte for byte, a wrong key and no key getting 401, the write reply's keys, a
sync from 0, a seed with a clashing pair and a refused second seed, and a scan
of every reply for rule-stating words. It prints one PASS or FAIL line per check
and exits non-zero on any failure. At the end, pass or fail, it deletes both
tenants' rows from every `ledger` table with `supabase db query --linked` and
checks that none remain.

The secret key is the stored commons credential (the DPAPI file), loaded by the
commons server's `config.ts` with the key environment variables blanked; it is
never printed. `ts-js-hook.mjs` lets Node load that TypeScript source. The CLI is
found at `~/tools/supabase-cli` (override with `SUPABASE_CLI_JS`, the CLI's
`dist/supabase.js`) and runs in `--workdir`, by default a fresh temporary
directory, so it writes no `supabase/.temp` into the repo.
