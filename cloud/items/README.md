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
