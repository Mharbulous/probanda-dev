# Plan: per-install keys, and commons reads through edge functions only

> **Revised by `docs/Plans/2026-10-18_lawyer-only-access.md`, which governs where the two overlap.** Its section 10 lists the changes: no scopes, one key per device owned by a lawyer account, the troubleshooting store moved into this project on the same key, the maintainer secret in `POOL_SECRET_KEY` or a maintainer-only file and never in the plugin's credential file, decision 8's lawyer-key writes narrowed, and `resolve_key` replaced by a metering function.

> **Stage 1 is applied and deployed (2026-10-16).** `access.sql` is applied and `items-write`, `items-sync` and `items-seed` run the new `caller.ts`, `db.ts` and `items.ts`. Every stage 1 check passed: `check_items.mjs`, the four test-key checks, and `anon` and `authenticated` both without `USAGE` on `access`. The test key and its rows are deleted, so no install key exists yet. Stage 0 was skipped, because only stage 2 needs its snapshot, and it runs before stage 2. Stage 2 (`commons-read`, the reworked `commons-find`) is written, not deployed. The research client change is stage 3's work, held by Brahm's decision until `commons-read` is deployed and checked. As of 2026-10-22 nothing has moved since: the next work is the stage 0 snapshot, then stage 2.
>
> **The Suggestion Box is live (2026-10-16).** `cloud/suggestions/suggestions.sql` is applied and `suggestion-submit` is deployed. A POST with the project secret returns a `suggestion_id`, a POST with no key gets 401, and the constraint accepts `suggestions:write`.

Written 2026-10-14. It settles open decision 4 of `docs/Plans/2026-10-14_practice-db-conversion.md` ("give each user their own credential before a second practice uses this").

## Context

Every machine's credential file holds the Supabase project's secret key (`sb_secret_` or `service_role`). That key opens every schema, so whoever holds it can read the rulebook (`rules`), the ledger (`ledger`) and the structure of the pool (`legal_commons`). The commons server calls `legal_commons` tables and functions by name through PostgREST. The `items-*` functions take `tenant` from the request body, so any key holder can act as any tenant. This conflicts with Commandments 2 and 4. Exception 2 tolerates it only while just Brahm's machines run the plugin, and it blocks moving any commons tool into the Published Plugin.

The outcome: each installed copy holds its own install key, which the cloud resolves to one tenant and a set of scopes. Every read of the pool goes through an edge function. The project secret is then rotated, held only in an environment variable on development machines, and `legal_commons` comes off the exposed API schemas.

## Decided

1. Seven stages, 0 to 6, each of which keeps every installed copy working. Stage 5 is the only one-way stage.
2. Install keys, not Supabase Auth JWTs (that would mean a login flow and a change to how the data server authenticates), and not a gateway that proxies PostgREST (that would leave table names in the client).
3. Every tool name, input and output stays the same, and the read tools' outputs stay byte for byte the same.
4. The data server needs no code change and its bundle is not rebuilt for this plan. It sends whatever key the shared credential file (`source/mcp-shared/commons-key.js`) holds, in `apikey` (`source/practice/mcp/src/practice/cloud.ts:55`).
5. The project secret stays accepted until stage 5. A refusal asks a question and never states a rule (Commandment 6). No function logs a request body.
6. Brahm, 2026-10-14: the research client change waits for stage 3, after `commons-read` is deployed. A `/repackage` in between must not ship a client whose reads call a function that does not exist yet.
7. Brahm, 2026-10-16: the Suggestion Box uses the same key. A third scope, `suggestions:write`, lets a key call `suggestion-submit`, which only inserts into `suggestions.suggestion` (`cloud/suggestions/suggestions.sql`). GitHub posting is gone, and `legal_commons__configure_credential` takes the key on a local page instead of as a tool argument.
8. Brahm, 2026-10-16: the legal commons is to be fully crowd-sourced, with no opt-out. Research, note-ups and verifications a lawyer runs are contributed in the background, so the next lawyer's research costs less. When contributor writes are built (a separate piece of work, after stage 3), an install key may use `push`, `link_authority`, `record_treatment`, `stamp_verified`, `rule_period_push` and `rule_period_record_verification`. `amend_*`, `merge_authority`, `unlink_authority` and `rule_period_retire` stay with the project secret (maintainers).

## What the files show (2026-10-14)

- **The callers' check.** `_shared/caller.ts` compared `apikey` with `SUPABASE_SECRET_KEYS` and nothing else. `commons-find/index.ts` held its own copy of that check, because it was deployed from the dashboard editor.
- **Keys forwarded to PostgREST.** `commons-find` and `_shared/pool.ts` (`callPool`, `clausesAfter`, used by `commons-search`, `commons-contribute` and `commons-reembed`) send the caller's own key on to `/rest/v1/` with `Content-Profile: legal_commons`. An install key would fail there, and once `legal_commons` is unexposed every one of them fails.
- **The research client** (`source/research/commons-mcp/src/legal-commons/client.ts`) calls `/rest/v1/rpc/${fn}` with `Content-Profile` set to the schema. The read functions are `resolve_principle`, `find_candidates`, `lookup_by_citation`, `browse_principles`, `treatment_chain` (`tools.ts`) and `rule_periods_find` (`rule-periods.ts`). `configure_credential` tests a key with `client.get("principle", …)`, a table read. Search already goes through `/functions/v1/commons-find`.
- **Every read function returns `jsonb`.** Read from the live project on 2026-10-14 with `pg_get_function_result`. `browse_principles` is defined in no SQL file in this repo or in CoClerk, only in the live project.
- **The write tools** (`push`, the `amend_*` tools, `link_authority`, `unlink_authority`, `merge_authority`, `record_treatment`, `stamp_verified`, the `rule_period_*` writes) use PostgREST tables and functions. `source/research/hooks/commons-read-only.py` refuses them in Probanda.
- **The tenant** is one random UUID in practice.db's `meta` namespace (`source/practice/mcp/src/practice/store.ts:139`). practice.db is one SharePoint-synced file, so all of Brahm's machines share one tenant.
- **Other holders of the secret.** `cloud/items/tools/check_items.mjs` and `scripts/migrate_practice_db.py` load the DPAPI credential as the project secret. `cloud/legal-commons/tools/contribute.mjs` and `contribute_verdicts.mjs` take it from the environment. The troubleshooting store is a separate project with its own credential, and this plan does not touch it.
- **Tests.** `source/research/commons-mcp/test/legal-commons.test.mjs:202` asserts that browse calls `rpc`. It must follow the client at stage 3.

## Design

### Install keys

A key is `pb_install_` followed by 32 random bytes in base64url. The cloud stores only its SHA-256, as lowercase hex, in `access.install_key` (`cloud/access/access.sql`): `key_hash`, `label` (the machine, never a person), `tenant`, `scopes`, `created_at`, `revoked_at`. `access.resolve_key(hash)` returns `{tenant, scopes}` for a live key, or null. The schema is not exposed and grants nothing to `public`, `anon` or `authenticated`.

The scopes are `commons:read` (`commons-read`, `commons-find`), `items:write` (`items-write`, `items-sync`, `items-seed`) and `suggestions:write` (`suggestion-submit`, decision 7). A key with `items:write` must have a tenant.

### Who may call (`_shared/caller.ts`)

- One of the project's secret keys may call every function, as today. An items body names its own tenant.
- An install key may call only a function that names one of its scopes in `serve(…, {scope})`. A function with no scope (`commons-search`, `commons-contribute`, `commons-reembed`) accepts the project secret only, and never looks up an install key.
- An unknown, revoked or out-of-scope key gets 401 before the body is read. A database fault during the lookup gets a generic 500 and logs its SQLSTATE only.

### The tenant (`_shared/items.ts`)

For an install key, `serveItems` refuses a body whose tenant is not the key's tenant, before any `rules` call: `{saved: false, question: "Which practice is this for? This request names a different practice from the one this machine was set up with."}`. The check lives once, in `items.ts`, so the three items functions are unchanged.

### Reads (`commons-read`, `commons-find`)

`commons-read` takes `{fn, args}`. `fn` names one of the six read functions, and `args` carries the same named arguments the client sends PostgREST today. Each `fn` maps to one fixed, parameterised call over `SUPABASE_DB_URL` (`_shared/db.ts`), and the reply is the function's `jsonb` unchanged, which is what PostgREST replied. An unknown `fn` gets 400. A fault gets a generic 502.

`commons-find` uses `caller.ts` and reads `clause_search`, `principle`, `principle_authority` and `authority` over the same connection. Its reply is unchanged.

### The research client (stage 3)

In `source/research/commons-mcp/src/legal-commons/`:

- `client.ts`: add `read(fn, args)`, which is `callFunction("commons-read", {fn, args})`. The not-configured hint names the install key.
- `tools.ts`: the five reads call `client.read` with their current arguments. `configureCredential` tests a key with `client.read("lookup_by_citation", {p_citation: "configure_credential check"})`. Its refusal of a publishable key names a `pb_install_` key or the project secret.
- `rule-periods.ts`: `findRulePeriods` calls `client.read("rule_periods_find", …)`.
- `test/legal-commons.test.mjs` follows the change.

After stage 3, no read path in `commons-mcp/src` calls `/rest/v1/`. The write tools keep PostgREST and stop working at stage 6. They are refused today, and a write function is a separate piece of work.

## Stages

Each stage ends with its check passing, a commit by pathspec and a push to `main`.

| Stage | Work | Check that fails if the stage is wrong |
|---|---|---|
| 0 | Inventory: every PostgREST caller of `legal_commons` (grep of the repo and CoClerk for `/rest/v1`, `Accept-Profile`, `Content-Profile`) and every holder of the secret (each machine's DPAPI file, environment variables, scripts). Record a snapshot: each of the six reads through PostgREST with fixed arguments, and three searches, saved as JSON in the scratchpad (never committed). Send `apikey: pb_install_x` to `items-write`. | The inventory lists the files named under "What the files show" or more. The snapshot holds 9 replies. The `pb_install_x` reply is the function's own body `{"error":"not authorized"}`, which shows that the gateway passes a non-Supabase key through. |
| 1 | Apply `cloud/access/access.sql`. Insert one test key by hash, for a fresh tenant, with both scopes. Deploy `items-write`, `items-sync` and `items-seed` with the new `caller.ts`, `db.ts` and `items.ts`. | `check_items.mjs` passes unchanged with the project secret. With the test key: a write for its tenant is saved, a write for another tenant gets the question, and the key with `items:write` removed gets 401. With `revoked_at` set: 401. `has_schema_privilege('anon','access','USAGE')` is false, and the same for `authenticated`. The test tenant's rows and the test key are then deleted. |
| 2 | Deploy `commons-read` and `commons-find` with the CLI (`supabase functions deploy commons-read commons-find --use-api --project-ref nbzkuhgiqscjkypedqff --workdir cloud/legal-commons`). | With the project secret and with a `commons:read` test key, each of the six reads through `commons-read` with the stage 0 arguments equals its stage 0 reply after `JSON.parse`, and each search equals its stage 0 reply. A key with `items:write` only gets 401 from both. |
| 3 | The research client change above. `/release` research as a patch. | A grep of `source/research/commons-mcp/src/legal-commons/` finds `/rest/v1/` only in `client.ts`, and finds no read tool calling `get` or `rpc`. `npm test` in `source/research/commons-mcp/` passes. **Gate: every machine shows the new research version** (`~/.claude/plugins/synced/`, checked against the time on `.last-complete-round`). |
| 4 | `scripts/mint_install_key.mjs`, private and never shipped. Run on each machine in turn, it generates a key, reads the tenant from practice.db's `meta`, inserts the hash with a label, and writes the key into that machine's Credential Manager entry with `saveCommonsKey` (`source/mcp-shared/commons-key.js`). It never prints the key. `check_items.mjs` and `migrate_practice_db.py` read the maintainer key from the environment. Keys expire after 30 days and renew silently (lawyer-only-access section 3.6): `expires_at` is added to `access.install_key` by hand in the SQL editor, because no change may add schema DDL to the repo, and the mint script sets it. A `key-renew` function issues the fresh key, and the shared key reader (`source/mcp-shared/commons-key.js`) renews once the key is 23 or more days old and writes the new key to Credential Manager. | On each machine, `legal_commons__configure_status` shows a hint starting `pb_install`. A practice write (`upsert_task`, then `complete_task` on a test to-do) and a commons read (`legal_commons__browse`) both work. `select count(*) from access.install_key where revoked_at is null` equals the number of machines. A test key aged 23 days renews, the old key works until the new key's first call and then gets 401, and a key past `expires_at` gets 401. |
| 5 | Rotate the project secret and delete the old one in the dashboard, with Brahm's approval. The new secret goes only into the maintainer environment variable on development machines. In the same release, `cloud_key__configure_credential` (`source/lawyer/mcp/src/key-request/`) refuses a key that starts `sb_secret_` or is a `service_role` JWT, before the Cloud check and before saving, with a message that does not echo the key (Brahm, 2026-10-22). Not earlier, because stage 4's rollback reinstalls the project secret with that tool. The practice-data skill's "Probanda's key" section then says each key is per-device, belongs to one lawyer account and renews itself every 30 days. | The old secret gets 401 from `items-write` and `commons-read`. Every machine still reads and writes as in stage 4. `cloud_key__configure_credential` refuses a test `sb_secret_` value and saves nothing, a `pb_install_` key still installs, and tests cover both. |
| 6 | `_shared/pool.ts` (`callPool`, `clausesAfter`) moves to `SUPABASE_DB_URL`. Then `legal_commons` is removed from the exposed API schemas. | PostgREST with the new secret and `Content-Profile: legal_commons` gets `PGRST106 Invalid schema`. `commons-search` and `commons-reembed` answer as before. Every read and search on every machine works. |

### The gate between stages 3 and 4

An installed copy older than stage 3 reads the pool through PostgREST, which refuses an install key. So no machine's credential file gets an install key until every machine shows the stage 3 research version. A machine that misses the sync keeps the project secret until it catches up. Stage 5 waits for every machine to pass stage 4.

## Rollback

| Stage | Rollback |
|---|---|
| 0 | Nothing to undo. |
| 1 | Redeploy the three items functions from the commit before this plan. `access` is then unused. Drop it only if stage 1 is abandoned. |
| 2 | Redeploy `commons-find` from the commit before this plan. `commons-read` is unused until stage 3. |
| 3 | Release the previous client code as the next patch. It works because the project secret is still accepted. |
| 4 | On the machine, run `cloud_key__configure_credential` with the project secret, then revoke its install key. Reverting renewal alone would let every key lapse at 30 days, so `key-renew` and the `expires_at` check are reverted together. |
| 5 | None. A deleted secret cannot be restored. Each machine keeps working on its install key, and the maintainer uses the new secret. |
| 6 | Add `legal_commons` back to the exposed schemas. `pool.ts` on `SUPABASE_DB_URL` works either way. |

## Open decisions for Brahm

Each has a default the executing session takes if he says nothing before the stage that uses it.

1. **Key scope (stage 4).** Default: one key per machine, each with all three scopes and the shared tenant, so one machine's key can be revoked alone. The alternative is one key per practice, which is simpler to mint but cannot be withdrawn from a single machine.
2. **The maintainer key (stages 4 and 5).** Default: the project secret lives only in `LEGAL_COMMONS_SUPABASE_KEY` on development machines, for the scripts that need it (`check_items.mjs`, `migrate_practice_db.py`, `contribute.mjs`), never in a credential file. Because the environment wins over the file (`commons-key.js`), the plugin on a development machine with the variable set runs as the maintainer, not on its install key. Stage 4's check runs with the variable unset.

## Risks

- **Byte-for-byte reads.** PostgREST and postgres.js both pass on Postgres's stored `jsonb` key order, and the client re-parses the reply, so the parsed outputs should match. Stage 2 compares them with the stage 0 snapshot before any client depends on them. Error texts from a failed read may change wording. `commons-find` reads its link rows unordered, as it did through PostgREST.
- **Function rights.** The pool's functions withdraw `PUBLIC` execute and grant `service_role`. The direct connection runs as `postgres`, which owns them. Stage 2's check would fail if it did not.
- **One connection per function.** `db.ts` keeps `max: 1`. An items request runs its key lookup before its transaction, never during it.
- **The write tools stop at stage 6.** They are refused today. A Published Plugin that needs commons writes needs a write function first.
