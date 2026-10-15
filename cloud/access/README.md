# Install keys in Probanda's Cloud

`access.sql` holds schema `access`: one row per installed copy's key (its SHA-256 only), the tenant it writes for and its scopes, and `access.resolve_key(hash)`. The design and its stages are in `docs/Plans/2026-10-14_install-keys.md`.

Apply it to the project `nbzkuhgiqscjkypedqff` the way `../items/README.md` applies `ledger.sql`. It is idempotent and safe to re-run.

The schema is not exposed through the API and grants nothing to `public`, `anon` or `authenticated`. Only edge functions, connecting as `postgres`, read it (`../legal-commons/supabase/functions/_shared/caller.ts`). Keys are minted by a private script that writes each key straight into one machine's credential file and never prints it.
