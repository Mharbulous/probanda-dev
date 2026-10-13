# Plan: restructure the legal-commons pool for the revised structure

Written 2026-10-13, revised the same day after a review against the files and Supabase's documentation, and again on 2026-10-13 after a second review (plain language, untested assumptions, and the findings at the end). Later the same day the findings were worked through: the re-embedding was split into batches, which added a tenth table and a seventh function, and malformed values now get a question in reply. This is the build plan for the database. The reasons for the design, and the evidence behind it, are in the schema plan ("Plan: consequence-first structure for the legal-commons pool", revision 3, kept in the maintainer's plans folder). This file does not repeat them. Where the two differ, this file is the later one and says so.

The pool is a Postgres database hosted by Supabase, on the free plan. The plugin reads and writes it through Supabase's web interface. This plan adds ten tables, one field, seven database functions and three Edge Functions to it, and then fills the new tables from the 16 principles the pool holds today.

Terms are used as the root `GLOSSARY.md` defines them. The database words below recur, and each is defined here once:

- A **schema** is a named group of tables and functions inside one database. Everything the pool holds sits in the schema named `legal_commons`. A **scratch schema** is a throwaway copy made for a test and dropped afterwards.
- A **migration** is a SQL script applied once to change a database's structure.
- A **transaction** is a group of changes that either all take effect or none do.
- A **foreign key** is a rule that a value in one table must exist in another, so a link can never point at nothing.
- A **view** is a saved query that reads like a table.
- A **generated column** is a column the database fills in itself from other columns of the same row.
- A **uuid** is a random 128-bit number used as an id. A **timestamptz** is a date and time with its time zone.
- An **embedding** is the list of 384 numbers the `gte-small` model makes from a text, placed so that texts with similar meaning get nearby numbers. **Cosine similarity** is the nearness score between two embeddings, from 0 to 1, with 1 for identical.
- An **Edge Function** is a small program that Supabase runs on its own servers, outside the database. Within Supabase, only an Edge Function can run the embedding model.
- **PostgREST** is the web interface through which the plugin reads and writes the pool's tables and calls its functions. A **role** is a named set of database permissions. **`service_role`** is the role the pool's secret key acts as. A **grant** gives a role the right to use a table or function.
- The pool's **secret key** is the project's `sb_secret_` key, held by the plugin and never shown. A **JWT** is a different kind of signed token, which Supabase uses for logged-in users. The pool has no users and uses no JWTs.
- The **SQL editor** is the page in Supabase's dashboard where a person pastes and runs SQL against the live project.
- The **command-line tool** is Supabase's program for a developer's machine (`supabase`), used here only to deploy Edge Functions.

## What changes and what does not

The restructuring is additive. It adds ten tables, one field on an existing table, seven database functions and three Edge Functions. It changes no existing column, drops nothing and moves no row. Every tool the plugin has today reads and writes the same tables as before.

| Existing object | What happens to it |
|---|---|
| `principle`, `authority`, `treatment`, `rule_period`, `rule_period_verification` | Unchanged |
| `principle_authority` | Gains one field, `pinpoint` |
| `criterion`, `principle.variant_of`, `principle.variant_note`, `principle_redirects` | Kept and still readable. Nothing in the new structure writes to them. The existing tools go on writing them as they do today: `push_principle` still adds `criterion` rows for a new principle, and `amend_criterion_text` still corrects one |
| The ten existing functions (six in `functions.sql`, four in `rule_periods.sql`) | Unchanged |

One consequence of the last row: a principle pushed after phase 5 arrives with `criterion` rows and no test. It is decomposed later by the phase 5 pipeline, and the phase 5 queries are re-run after each such batch.

## The new tables

All sit in the `legal_commons` schema. Every table has `created_at`. Names below are the names to build. The legal terms (clause, test, consequence, element, exception, factor, rationale, principle) are as `GLOSSARY.md` defines them.

### `clause`: one self-contained statement

| Field | Type | Rule |
|---|---|---|
| `clause_id` | uuid | Key |
| `text` | text | Required |
| `text_key` | text | The tidied text. A generated column, filled from `text` by `tidy_clause_text`. Unique |
| `embedding` | `vector(384)` | Required |

No jurisdiction, no contributor and no type. A clause gets its type from the link that uses it.

Two points of mechanics. Postgres fills a generated column with a user-written function only when the function is declared `immutable` (always the same result for the same input), which `tidy_clause_text` is. The `vector` type comes from the `vector` extension, which Supabase installs into its `extensions` schema, so the column is declared as `extensions.vector(384)`.

### `clause_part`: the reading aids for one outcome inside a consequence

| Field | Type | Rule |
|---|---|---|
| `clause_id` | uuid | Foreign key to `clause` |
| `part_order` | integer | Key with `clause_id` |
| `actor` | text | Free text |
| `discretionary` | boolean | Required |
| `polarity` | text | `affirmative` or `negative` |

The three reading aids are the ones `GLOSSARY.md` describes under Consequence. A simple consequence has one part. A compound consequence has one part for each linked outcome. A clause used only as a condition or a rationale has no parts. This departs from the schema plan's Design table, which put the three aids on the clause. See default 1.

### `test`: one route to one consequence

| Field | Type | Rule |
|---|---|---|
| `test_id` | uuid | Key |
| `consequence_clause_id` | uuid | Required. Foreign key to `clause` |
| `contributor` | text | The id the contributing install made up for itself |
| `retired_at`, `retired_by`, `retired_note` | timestamptz, text, text | Empty while the test is live. `retired_by` was added in phase 2, so that the contributor `retire` is given has somewhere to go |

### `test_clause`: one condition of one test

| Field | Type | Rule |
|---|---|---|
| `test_id` | uuid | Foreign key to `test` |
| `clause_order` | integer | Key with `test_id` |
| `clause_type` | text | `element`, `exception` or `factor` |
| `clause_id` | uuid | Foreign key to `clause` |
| `points_to_test_id` | uuid | Foreign key to `test` |

Rules the table enforces itself: exactly one of `clause_id` and `points_to_test_id` is filled, `points_to_test_id` is allowed only on an exception, and one clause appears at most once in a test. Rules the write function enforces, because a table cannot: a test's condition is never its own consequence clause, and a chain of exceptions that point at tests never leads back to where it started. Example of the second: test A has an exception pointing at test B, and B has an exception pointing back at A. Neither can be stored first, so the write is refused.

Nothing here lets a clause attach to another clause, which is how "exceptions attach to tests only" is kept.

### `test_principle`: one principle stating one test (the stated-in link)

| Field | Type | Rule |
|---|---|---|
| `test_id` | uuid | Foreign key to `test` |
| `principle_id` | uuid | Foreign key to `principle`. Key with `test_id` |
| `obiter` | boolean | Empty when not recorded. See default 2 |
| `principle_text_md5` | text | A checksum (a short fingerprint of a text that changes when the text changes) of the principle's prose as it stood when the test was decomposed |

No pinpoint. The checksum is new in this plan. It answers a gap the mapping found: `amend_principle_text` can change a principle's prose after its tests exist, leaving the tests describing the old wording. The search compares the checksum with the prose as it now stands and marks a test "stale" when they differ. No existing tool has to change.

### `test_rationale`: one clause explaining one test

| Field | Type | Rule |
|---|---|---|
| `test_id` | uuid | |
| `clause_id` | uuid | Foreign key to `clause` |
| `principle_id` | uuid | The principle that gives the reason |

All three fields form the key. The pair (`test_id`, `principle_id`) is a foreign key to `test_principle`, so a principle can give a reason only for a test it states. A rationale is never a row of `test_clause`, so nothing that compares two tests reads it.

### `meaning_verdict`: one judgment on two clauses

| Field | Type | Rule |
|---|---|---|
| `verdict_id` | uuid | Key |
| `clause_a`, `clause_b` | uuid | Foreign keys to `clause`. `clause_a` is always the smaller id, so a pair has one form |
| `a_implies_b`, `b_implies_a` | boolean | Both required |
| `judge_kind` | text | `person` or `model` |
| `judge_model`, `judge_prompt_version` | text | Required when the judge is a model |
| `contributor` | text | |
| `retired_at`, `retired_by`, `retired_note` | timestamptz, text, text | The last two were added in phase 2, for the same reason as on `test` |

A pair may have many verdicts. A verdict that says "different" is stored like any other.

A view, `clause_pair_state`, gives each pair one state from its live verdicts. If a person has judged the pair, the latest person's verdict decides. Otherwise the state is `equivalent` when every verdict says both directions hold, `different` when none does, and `conflict` when they disagree. Example: two model verdicts say A and B mean the same, a third says they do not, and no person has judged the pair: the pair is in `conflict` until a person's verdict settles it. The count of contributors is never used.

### `embedding_fingerprint`: which model made the embeddings

One row: the model's name, one fixed sentence and that sentence's embedding. Every write that carries embeddings also carries the model's fresh embedding of the fixed sentence, and the database refuses the write when the fresh embedding's cosine similarity to the stored one is below 0.999. The test is a threshold and not exact equality, because the same model on two machines, or on two builds, gives numbers that differ in the last decimal places. The threshold is the one phase 4 uses to accept the hosted model.

### `clause_embedding_staging`: new embeddings waiting for a change of model

| Field | Type | Rule |
|---|---|---|
| `clause_id` | uuid | Key. Foreign key to `clause` |
| `embedding` | `vector(384)` | Required. The clause's embedding by the new model |
| `fingerprint` | `vector(384)` | Required. The new model's embedding of the fixed sentence, as sent with the batch this row came in |

Empty except while the pool is being re-embedded. One Edge Function request cannot embed a whole pool (see "Limits" under Edge Functions), so the new embeddings arrive a batch at a time and wait here. The search never reads this table. `set_clause_embeddings` moves every row into `clause` in one transaction and empties the table, and it refuses while any clause has no row here or while the rows came with more than one fingerprint. The table was added on 2026-10-13 in answer to finding 1.

### `conversion_record`: what became of each old row

| Field | Type | Rule |
|---|---|---|
| `record_id` | uuid | Key |
| `principle_id` | uuid | Required |
| `criterion_id` | uuid | Empty for a record about the principle as a whole |
| `test_id`, `clause_id` | uuid | What the old row became |
| `reason` | text | Why it became nothing |

Either a target or a reason is filled. This is the home the mapping asked for. It makes the final check a query, and it keeps a path from a test's clause back to its old `criterion` row. That path is how the six `criterion` fields with no place in the new structure stay reachable. See default 3. The rows are written by `contribute_decomposition`, in the same transaction as the tests they describe, so no separate writer is needed.

### The one change to an existing table

`principle_authority` gains `pinpoint text`, empty on every existing row. One caution from the client code: `merge_authority` deletes a duplicate authority's link whenever the surviving authority already has a link to the same principle, and `unlink_authority` deletes a link outright. A pinpoint on a deleted link goes with it. That is correct for an unlink. For a merge it means the dropped link's pinpoint is lost even when the surviving link has none. The pool holds no pinpoint today, so no existing row is at risk, and `merge_authority` is not changed by this plan. A later change could copy the pinpoint across before the delete.

## Database functions

Each write function replies in one of two shapes: the write was saved, or it was not and here is a question about the item (Commandment 6). A refused write leaves no row behind. A value inside a payload that is not in its proper form, such as `"principle_id": "abc"`, also gets the second shape, and not the database's own error message. One limit on that: an argument the function declares with a type (`retire`'s id, `clause_search`'s embedding and limit) is converted by PostgREST before the function starts, so a malformed one is answered by PostgREST with the database's message. `commons-search` therefore checks the role and the limit itself before it calls the database, and `retire` is called only from Probanda's development machine. The one read function, `clause_search`, returns stored statements with their tests, as `resolve_principle` returns principles with their criteria today. Asked for a role it does not know, it returns an empty reply with a question. Both readers rest on Exception 4 of the Commandments, and what the plugin shows of a reply is Brahm's call at phase 7.

| Function | What it does |
|---|---|
| `tidy_clause_text(text)` | Kept in the migration file and not in `consequence_functions.sql`, because the `clause` table is built on it. The tidying rule of `normalize` in `source/probanda/mcp/src/phrases/rank.ts`, written in SQL: Unicode NFC (one fixed way of writing accented letters), trimmed, runs of white space made one space, one trailing period removed, case kept. Declared `immutable`. Postgres's `normalize()` needs the database encoding to be UTF8, which the pool's is (phase 1). Postgres's `trim()` removes only the plain space and its `\s` depends on the database's locale, while JavaScript's `trim()` and `\s` cover every Unicode space, so the SQL spells out the set of white-space characters instead of relying on either default. Both versions are tested against one shared list of strings that includes a tab, a line break, a no-break space (U+00A0) and a line separator (U+2028). Where they differ, `rank.ts` is the rule and the SQL is corrected |
| `clause_search(text, embedding, role, limit)` | Read only. First the clause whose `text_key` equals the tidied query, then the nearest clauses by cosine similarity among clauses in the role asked for (`consequence`, `element`, `exception`, `factor`, `rationale` or `any`), 10 unless told otherwise. For each hit: its text and parts, every live test it belongs to with that test's conditions, rationales, stating principles and stale mark, every clause reachable from it through `equivalent` pairs, and separately any pair in `conflict`. No similarity score is returned, because the trial showed the score cannot tell a rewording from a changed meaning |
| `contribute_decomposition(payload, contributor)` | Writes one principle's whole decomposition, with its `conversion_record` rows, or none of it. Reuses a clause whose `text_key` already exists. Reuses a test whose consequence clause and conditions are identical by id, adding only the stated-in link. Refuses an unknown principle, a principle id that `principle_redirects` lists as merged away, a failed or missing fingerprint and any broken rule of `test_clause` |
| `contribute_verdicts(verdicts, contributor)` | Stores verdicts, putting each pair in its one form. All or none |
| `retire(kind, id, note, contributor)` | Sets the retired date on a test or a verdict. Deletes nothing |
| `stage_clause_embeddings(rows, fingerprint)` | Holds one batch of new embeddings in `clause_embedding_staging`, each with the fingerprint the batch came with. Changes nothing the search reads. Staging a clause again replaces what was staged for it, so a run that failed part way is simply run again |
| `set_clause_embeddings(fingerprint)` | Replaces every clause's embedding, from the staged rows, and the fingerprint together, in one transaction, for a change of model. It also stores the first fingerprint while the pool has no clause. It refuses while any clause has no staged embedding, or while any staged embedding came with a different fingerprint from the one given, because a pool with embeddings from two models under one fingerprint would return wrong neighbours without saying so. A clause contributed while a re-embedding is under way has no staged row, so the swap is refused until that clause is staged too |

"Is this test already pooled" is answered in two layers. The write function matches by id only, which is exact. The search groups tests by meaning, by following `equivalent` pairs between their consequences and between their conditions. Two tests that mean the same are both kept.

There is no vector index. The search compares the query with every clause, which is exact and fast at a few thousand rows.

## Edge Functions

| Function | Does |
|---|---|
| `commons-search` | Embeds the query, calls `clause_search`, returns its reply |
| `commons-contribute` | Embeds each clause text and the fixed sentence, calls `contribute_decomposition` |
| `commons-reembed` | Asked for a batch: embeds the next clauses in id order (10 unless told otherwise) and the fixed sentence, calls `stage_clause_embeddings`, and replies with the id to continue from. Asked to finish: embeds the fixed sentence and calls `set_clause_embeddings`. `tools/reembed.mjs` makes these calls in order from the development machine. Asked to check (added in phase 4): embeds the texts it is given and returns the embeddings, reading and writing nothing, because no other function hands an embedding back and phase 4's comparison of the hosted model with a local one needs them |

Each creates the model as `new Supabase.ai.Session('gte-small')` and runs it with `mean_pool: true, normalize: true`, the settings Supabase's documentation gives for embeddings, and logs no text it receives. The client sends text and ids and never names a table. Only `commons-search` is ever reached from the plugin. The other two are run from Probanda's development machine, with the key supplied in an environment variable by the person running them. No script reads the stored credential file.

How a caller is admitted, from Supabase's documentation read 2026-10-13. By default an Edge Function accepts only a caller whose `Authorization` header carries a JWT. The pool's secret key is not a JWT, so each of the three functions is deployed with JWT verification off (`verify_jwt = false` in `supabase/config.toml`) and checks for itself that the `apikey` header holds a secret key of the project, refusing every other request before it reads the body. This is the pattern Supabase's own documentation gives for a function called with a secret key. The function makes the check against `SUPABASE_SECRET_KEYS`, a list of the project's secret keys that Supabase places in every Edge Function's environment, and then uses the caller's own key for the database call, so no key is stored with the function. Inside the function, the project's address arrives the same way (`SUPABASE_URL`), and the function calls the database function through PostgREST with the `legal_commons` schema named in the request, which works because that schema is already exposed for the existing tools.

One point for phase 7, from the same documentation: a secret key is to be sent in the `apikey` header only. The Edge Function platform treats a value in the `Authorization: Bearer` header as a JWT and rejects a secret key sent there with "Invalid JWT". The plugin's client today sends the key in both headers on every PostgREST call, and those calls work. Whether an Edge Function call carrying both headers also works is settled by a phase 4 check, so that the phase 7 tool knows which headers to send.

Limits that bear on this, from Supabase's documentation read 2026-10-13: an Edge Function may use 2 seconds of CPU time per request, 256 MB of memory, and on the free plan may run for 150 seconds in all before it is shut down. The 150 seconds is how long one worker stays alive, and the 2 seconds counts only time on the CPU, not time spent waiting on the database. Supabase's documentation does not say whether running the built-in model counts toward the 2 seconds, and nobody has measured what one embedding costs. Phase 4 measures it. Each function is built so that the answer changes a number and not the design: `commons-search` embeds one text. `commons-reembed` embeds one batch per request, and the batch size is an argument of the request, so it is lowered until a batch fits, down to one clause. `commons-contribute` embeds every statement of one principle in one request and cannot be split, because a decomposition is saved whole or not at all. If phase 4's measurement shows the largest pilot decomposition does not fit, the fix is to have the function embed in a first request and write in a second, and phase 5 waits for it.

## Defaults taken, each of which Brahm can reverse

1. **Reading aids are recorded once per part of a consequence**, not once per clause. Brahm's reading of pilot principle 4 is one compound consequence with two actors, and one actor field cannot hold that. Reversing this folds `clause_part` into three fields on `clause`.
2. **Obiter is recorded on the stated-in link, and left empty by this migration.** Nothing in the pool says which test of a principle an authority's `obiter` flag was about, so copying it would be a guess. `principle_authority.obiter` stays where it is. Neither field can say "this decision supports this one test of that principle". That would need a three-way link of test, principle and authority, and no existing row holds the information to fill one, so it is not built.
3. **The six `criterion` fields with no place get no new field** (`burden_of_proof`, `authority_id`, `in_force_date`, `repeal_date`, `treatment`, `treated_by_authority_id`). They stay on the old row, reachable through `conversion_record`. `repeal_date` is never turned into a retired date, because a retired date marks a mistake and a repeal does not.
4. **Nesting is not given a pointer.** `criterion.determined_by_principle_id` is recorded in `conversion_record` as its old row. The link between an outer test's element and an inner test's consequence comes from the shared clause or a meaning verdict.
5. **A principle that has tests cannot be deleted.** The foreign key from `test_principle` refuses it. The client code deletes rows only from `principle_authority` and `authority`, so no plugin tool deletes a principle today. A merge of two principles, which would write `principle_redirects` and remove a row, exists in no tool and could only be done by hand in the SQL editor. Phase 1's dump confirms that no database function or policy deletes one either.
6. **Testing uses a scratch schema in the live project.** This machine has neither Docker nor the Supabase command-line tool (both checked 2026-10-13), so a local copy of Supabase cannot run here. The scratch schema holds empty copies of the existing tables and the new objects, touches no pool row, and is dropped afterwards. It is still a write to the live project and waits for the phase 2 go-ahead. The alternative is installing Docker Desktop and testing locally. Embeddings in the scratch tests are any 384 numbers, since the Edge Functions are not deployed until phase 4. Since this default was written, the same tests have passed in PGlite on the development machine (phase 2 below), which changes what the scratch run adds. The phase 2 gate puts that choice to Brahm.

## Needed from outside the repository

The remaining phases rest on four things that are not in this repository. None may be committed here under a path from the maintainer's machine. The executing session confirms each is at hand before the phase that needs it.

- **The trial's files** (`results.json`, `report.md` and `trial.mjs`, in the maintainer's `gte-small-trial` working folder): the 681 rewordings, the 443 of them that reword consequences, which principle each test clause came from, and the local model setup. Needed at phase 4 (the 20-string embedding check runs the model locally) and phase 5 (the recall check).
- **The 16 pilot decompositions**, produced by the schema plan's step 3. They are in the maintainer's working folder for that step, as five decomposer runs and three checker runs. Which run Brahm approves is the phase 5 gate. Needed at phase 5.
- **The PGlite runner** used for phase 2's test run. It is a few lines in a temporary folder: install `@electric-sql/pglite` 0.3.16, open a database with the `vector` and `pg_trgm` extensions, create a `service_role` role, run the built script and print the result rows. It is re-created when the tests are re-run after a fix.
- **Node 22.18 or later** on the machine that builds the test script, because `tests/build_scratch_test.mjs` imports a TypeScript file directly. The development machine has 22.23.2.

## Phases, in order, each with its check

A "gate" is a point where Brahm decides whether and how to go on. Each gate below says what he is deciding.

### Phase 1. Learn the live pool's state (done 2026-10-13)

This is step 4 of the schema plan, unchanged, with three additions to what the dump must show: the distinct values of `criterion.requirement_type`, a row count for every table, and whether any function or policy deletes a `principle` row.

- Check: a written list of every difference from `schema.sql`, `functions.sql` and `rule_periods.sql`. Each difference is then applied to this plan and to the mapping before phase 2 starts.

Result, from two read-only queries Brahm ran in the SQL editor on 2026-10-13 (Postgres 17.6, encoding UTF8).

What matches:

- The eight tables, every column with its type, default and nullability, every index and every constraint match `schema.sql` and `rule_periods.sql`. There is no view, trigger, policy or row-level security in `legal_commons`.
- The ten functions match `functions.sql` and `rule_periods.sql`. The md5 of each live body equals the md5 of the body in the file, and the signatures, defaults and languages agree. None runs with its owner's rights.
- The `public` schema holds no table and no view, so no matter data is left in the project.
- No function in any schema deletes or truncates `principle`, and no foreign key cascades. Default 5 stands.

Differences:

1. The `vector` extension is already installed, version 0.8.0, in the `extensions` schema. The migration's `create extension if not exists` is therefore a no-op on the pool, and the down script leaves the extension in place. Phase 2 below is corrected.
2. Every existing function can be run by `PUBLIC` (every role), which is Postgres's default, while `functions.sql` describes the pool as granted to `service_role` only. The tables are granted to `postgres` and `service_role` only and no function runs with its owner's rights, so another role is refused at the first table a function touches. The existing functions are left as they are. Each new function withdraws the `PUBLIC` right. Phase 2 below is corrected.

Counts: 16 `principle`, 35 `criterion`, 3 `authority`, 14 `principle_authority`, 2 `rule_period`, 1 `rule_period_verification`, 0 `principle_redirects`, 0 `treatment`. The pool holds the 16 pilot principles and no others, so phase 5 has nothing beyond them to decompose. With 14 links for 16 principles, at least two principles have no authority, and their tests will reach none.

`criterion.requirement_type` holds `element` on 29 rows and `factor` on 6. No row holds `exception` and no row holds a value outside the three clause types, so the conversion needs no extra rule.

### Phase 2. Write and test the migration (done 2026-10-13)

- Files under `cloud/legal-commons/`: `migrations/0001_consequence_structure.sql` (`create extension if not exists` for `vector`, which does nothing on the pool because phase 1 found it installed, the ten tables, the view, the `pinpoint` field, indexes on every foreign key, grants to `service_role`, and `notify pgrst, 'reload schema'`, which tells PostgREST to notice the new objects), `migrations/0001_down.sql` (removes exactly what the first adds, and so leaves the `vector` extension, which was there before), `consequence_functions.sql` (each function granted to `service_role`, with the default right of every role to run it withdrawn), and `supabase/functions/` for the three Edge Functions with `supabase/config.toml` setting `verify_jwt = false`. The folder is named `supabase/` because the command-line tool reads its settings from a folder of that name.
- Test files under `cloud/legal-commons/tests/`: `scratch_test.template.sql` holds the tests, `tidy_cases.json` the shared list of strings, and `build_scratch_test.mjs` joins them with the shipped SQL files into one script that makes the scratch schema, applies the migration and functions, runs the tests, runs the down script, compares the schema with its state before, and drops the scratch schema, all in one transaction. The expected results of the tidying rule are computed by `rank.ts` itself when the script is built.
- Tests, each of which can fail: the tidying rule gives the same result in SQL and in `rank.ts` for every string in the shared list. A decomposition with an exception chain that loops is refused. A test whose condition is its own consequence is refused. Contributing the same decomposition twice leaves the row counts unchanged. A rationale for a test its principle does not state is refused. A write with a wrong fingerprint, or with none stored, is refused. Staging a batch of new embeddings changes nothing the search reads. A `set_clause_embeddings` call is refused while one clause has no staged embedding, and while the staged embeddings came with two fingerprints, and is saved once every clause is staged under one. A malformed id in a decomposition, a verdict or a staged batch, and an unknown role in a search, each get a question and not a database error. A search reaches a test through two `equivalent` pairs in a row, and does not follow a pair in `conflict`. A person's verdict overrides two model verdicts. Amending a principle's text marks its tests stale. Running the down script leaves the schema as it was before, shown by comparing a dump of the scratch schema taken before the migration with one taken after the down script.
- Check: all of the above pass, and `python scripts/check_publishable.py --new-since origin/main` reports no new problem.
- Done before the gate, 2026-10-13: the built script was run on the development machine in PGlite 0.3.16 (Postgres 17.5 compiled to run inside Node, with the `vector` and `pg_trgm` extensions), which writes nothing to the live project. All 32 tests passed. Each of nine deliberate faults put into the SQL, one at a time, made at least one test fail. After the findings were fixed the same day, the script was rebuilt and run again the same way: all 39 tests passed (the 32, one of them rewritten, plus seven new ones for staging and for malformed values), and each of eight further faults put into the new SQL was caught. PGlite is not Supabase: it has no `service_role` until one is made for the run, and it does not show how PostgREST passes an embedding to `clause_search`. The Edge Functions have not been run anywhere, because they need the hosted model, and are first exercised in phase 4.
- First scratch run, 2026-10-13: it stopped at the first test with "invalid regular expression: invalid character range" in `tidy_clause_text`, and left nothing behind. The function's white-space set was written as the characters themselves, and they were garbled between the file and the SQL editor. The set is now written as `\u` escapes, the builder refuses a migration, functions or down file that is not plain ASCII, and all 39 tests passed again in PGlite. The script is copied to the clipboard with `Get-Content -Raw -Encoding UTF8`, because Windows PowerShell otherwise reads a file as the machine's older character set.
- What a scratch run in the live project would add over PGlite: Supabase's own Postgres build (17.6 against 17.5), the installed `vector` 0.8.0, the real `service_role` and `extensions` schema. What it would not add: PostgREST's handling of the arguments, which phase 3 checks on the pool itself. It is a write to the live project (a schema is created and dropped), and nothing in the pool's own schema is touched.
- Gate, answered 2026-10-13: Brahm chose to run the tests in a scratch schema in the live project before phase 3.
- Second scratch run, 2026-10-13, of the script built from the SQL as corrected after the first run: all 39 tests passed in the live project, the last of them being that the down script leaves the schema as it was. The script dropped its scratch schema at the end, so the project holds nothing from the run. On the editor's "Potential issues detected" dialog, which appears because the script makes tables without row-level security, the button to press is "Run without RLS".

### Phase 3. Apply to the pool (done 2026-10-13)

- Before: run `resolve_principle`, `find_candidates`, `lookup_by_citation`, `treatment_chain` and `rule_periods_find` on fixed inputs and save the replies.
- Before, added after a review on 2026-10-13: one query in the SQL editor confirms that `postgres` owns every table of the schema (adding the `pinpoint` field needs ownership) and that neither the `anon` nor the `authenticated` role may use the schema (nothing in either file sets that, and the new tables rely on it).
- Apply the migration, then the functions file, each as one paste in the SQL editor. If a paste stops with an error, run `rollback;` alone before trying again, because the editor's connection may be left inside the failed transaction.
- Check: the same five calls return identical replies. The ten tables exist and are empty. The seven functions exist, and the `anon` role can run none of them and read none of the ten tables. The plugin's `browse` tool still answers. Through PostgREST with the secret key, as the plugin and the Edge Functions will call it: a read of `clause` returns an empty list, and a call of `clause_search` with any text and a list of 384 numbers as the embedding returns a reply with an empty `nearest` list rather than an error. That last call proves, before any Edge Function exists, that PostgREST passes an embedding to the function, that the new grants are right and that PostgREST has seen the new objects. Supabase's own documentation calls a function with a `vector` argument this way, so it is expected to work, but it has not been run against this pool.
- Undo if anything fails: `0001_down.sql`, one paste.
- Result, 2026-10-13, on Brahm's go-ahead after the review recorded under "Findings from the review before phase 3". The pre-check passed: `postgres` owns every table and neither public role may use the schema. The first attempt at the migration left nothing, because a `rollback;` line copied from the instructions had replaced the migration on the clipboard and was what the editor ran. The functions file was therefore applied first, which Postgres allows because it does not check a function's body against the tables until the function is called. The migration was then applied, and the two files stand in the pool as written. The check passed: the ten tables exist and are empty, the seven functions exist, no `pinpoint` is filled, the `anon` role can run none of the functions and read none of the tables, and the five calls and `browse` gave replies identical to those saved before. Through PostgREST with the secret key in `apikey` alone, a read of `clause` returned `[]` and `clause_search` with a list of 384 numbers returned `{"exact": null, "nearest": []}`.
- Learned on the way: Supabase refuses a secret key from a caller whose `User-Agent` header looks like a browser's, with "Forbidden use of secret API key in browser". Windows PowerShell's `Invoke-WebRequest` sends such a header by default, so a call made from it names its own (`-UserAgent`). Node's `fetch`, which the plugin and `tools/reembed.mjs` use, is not affected. Instructions for a paste give one thing to copy per step.

### Phase 4. Deploy the Edge Functions (gate: Brahm's choice of deployment route, and his go-ahead)

- Two ways to deploy, neither installed today: the command-line tool with `supabase functions deploy --use-api`, which bundles the code on Supabase's servers and needs no Docker, or the dashboard's editor, where the code is pasted by hand and no history of earlier versions is kept. The command-line tool is preferred because the deployed code then matches the files under `cloud/legal-commons/supabase/functions/`.
- Gate question for Brahm: command-line tool or dashboard editor? The command-line tool needs installing (one `npm` or `scoop` command), a `supabase login`, which asks for a personal access token that Brahm creates in the dashboard and pastes himself, and a `supabase link` to the project. The dashboard route needs none of that and is fine for three short files, but a later change must be pasted again by hand.
- Gate, answered 2026-10-13: Brahm approved phase 4 and chose the command-line tool. Version 2.118.0 of the `supabase` npm package is installed on the development machine, in a tools folder outside this repository, with the exact version pinned and install scripts off (the package ships its program as a per-platform dependency and has no install script). Not yet done: `supabase login`, which Brahm runs himself, and everything below. With `--project-ref` given, `functions deploy` needs no `supabase link`, and `--workdir` points it at `cloud/legal-commons`.
- `supabase/config.toml` names the project (`project_id`), which the command-line tool requires.
- Store the fingerprint: call `commons-reembed` once with `{"finish": true}` while `clause` is empty. It then stores only the fingerprint row.
- Check: 20 fixed strings embedded on this machine (the trial's local model setup) and through the hosted function give a cosine similarity of at least 0.999 for each pair. A request to each function with no `apikey` header, or with the project's publishable key, is refused with 401, and a request with the secret key in `apikey` alone is accepted. A request with the secret key in both `apikey` and `Authorization: Bearer`, the shape the plugin's client sends today, is either accepted or rejected, and the answer is written into phase 7. From the function's logs, the CPU time one `commons-search` call takes, so that the cost of one embedding is known, the batch size of `commons-reembed` can be set, and it is known whether `commons-contribute` can embed the largest pilot decomposition in one request (see "Limits" under Edge Functions). A marker string is sent in one test search, and the project's Edge Function and API logs are then read for it (finding 5).
- How the check is run: `tools/check_functions.mjs` makes every call above that carries a key, stores the fingerprint, and writes the hosted embeddings of the 20 strings in `tests/embedding_cases.json` to a file. It embeds them in requests of 1, 1, 2, 4 and 12 strings and times each, so the largest request is the size of the largest pilot decomposition (11 statements and the fixed sentence). Brahm runs it in his own terminal with the two keys in environment variables. The comparison with the local model, and the reading of the logs, follow from its output.
- Measured before the deploy, 2026-10-13: the trial's local model was run on the 20 strings in both of its forms, the compressed one the trial used (`q8`) and the full-precision one (`fp32`). The two score as low as 0.997809 against each other, below the 0.999 this check asks for. The hosted model can therefore be expected to reach 0.999 against one form and not the other. The comparison reports both. If the hosted model matches `fp32` and not `q8`, nothing is broken, and whether the check then compares against `fp32` is Brahm's decision. The 0.999 threshold of the fingerprint is not affected, because it compares the hosted model with itself.
- State at the end of that session: the command-line tool was still not logged in, so nothing is deployed and no fingerprint is stored.
- The recall check that the schema plan placed here moves to phase 5, because the `clause` table is empty until then and a search over it can find nothing.
- Undo: delete the three functions in the dashboard. The fingerprint row goes with the tables if phase 3 is undone, or is left in place harmlessly if not.

### Phase 5. Load the decompositions (gate: Brahm's review of the 16 pilot results)

- Gate: Brahm has reviewed the 16 pilot decompositions and approved them. The executing session asks where they are before it starts (see "Needed from outside the repository").
- Contribute the 16 approved decompositions, each with its `conversion_record` rows, through `commons-contribute`.
- Phase 1 found no principle beyond the 16. A principle pushed later is decomposed and contributed, in batches, by the same two-agent pipeline as the pilot. A person reviews every checker flag and one in ten of the rest.
- Check, as queries: every principle has a test or a `conversion_record` reason for none. Every `criterion` row has a `conversion_record` row. Every test has at least one stated-in link (the write function always makes one, so this catches only a hand edit). The `principle_authority` links of principles recorded with a reason for no test are listed for Brahm, since those authorities now reach no test and only he can say whether that is right.
- Check, end to end: each of the 443 consequence rewordings from the trial is sent through `commons-search`, and in at least 95% of them a clause from a test stated by the rewording's own source principle is in the top 10. The source principle of each trial clause is known from the trial's files, and a pooled clause reaches its principle through `test_principle`. The trial's clauses and the pilot's clauses were cut from the same 16 principles by different hands, so a miss can mean either that the search failed or that the pilot worded the point differently from the trial. This is the first search over real pooled clauses, so a result below 95% stops phase 6 until the misses have been read and sorted into those two kinds.

### Phase 6. Judge meaning (no further gate)

- Candidate pairs: for each clause, its nearest 10 in the same role (found through `commons-search`), and for each `variant_of` pair of principles, their consequences. Each pair goes once to the `equivalence-checker` agent (`source/probanda/agents/equivalence-checker.md`), and its verdict in both directions is stored through `contribute_verdicts`.
- Check: every candidate pair has a verdict. Every pair in `conflict` is listed for Brahm, since only a person settles one.

### Phase 7. Give the plugin the search (step 8 of the schema plan, unchanged)

One read tool that calls `commons-search`, sending the secret key in the headers phase 4 found to work. No schema particulars in any skill or agent file, or under `plugins/` or `public/`. The plugin writes nothing from a reply to disk.

Gate question for Brahm, the one the schema plan's "Not goals" left to this step: what may the tool show a user of a search reply? A reply holds a test's clauses with their types (element, exception, factor), its consequence's reading aids and its `equivalent` links, which together are the structure of a rule. Today's `resolve_by_id` already sends a principle's criteria with their types to a user's machine, under Exception 4. The choices are: show the whole reply, which relies on Exception 4 exactly as today's tools do; show only the clause texts and the principle ids, so the rule's structure stays in the cloud (Commandments 4 and 5 are then not in question, and the user follows a principle id to the prose as today); or something between, which Brahm names. Until he answers, no tool is built.

## Undoing it

Phases 3 and 4 are undone by `0001_down.sql` and by deleting the three Edge Functions. Because nothing existing was changed, the pool is then exactly as it was, apart from the `pinpoint` field, which the down script also removes together with anything it held. Phases 5 and 6 only add rows to the new tables, which go with the tables. Phase 7 is undone by removing the tool and releasing the plugin again, and must be undone first, because a released tool that calls a deleted function fails for every user.

## Out of bounds

As the schema plan states them: no write to the live project and no deployed function without Brahm's go-ahead at that phase, no allowlisting of `legal_commons__*`, no reading or printing of the credential, nothing under `cloud/` copied into `plugins/` or `public/`, and no statement of what the law is.

## Findings from the review of 2026-10-13, and what became of each

Found by reading the built files against this plan and Supabase's documentation. Each was then checked against the code and the documentation again, the same day, and either fixed or left standing with the reason.

1. **Fixed. `commons-reembed` could not fit in one Edge Function run.** Confirmed: the function embedded every clause in one request, `set_clause_embeddings` refused any call that left a clause out, and Supabase's limits page (read again 2026-10-13) gives 2 seconds of CPU time per request, 256 MB of memory, and 150 seconds as the life of a worker on the free plan. The page gives no limit on the size of a request. Fix: the `clause_embedding_staging` table, the `stage_clause_embeddings` function, a `set_clause_embeddings` that swaps from the staged rows and keeps its all-or-none rule, a `commons-reembed` that embeds one batch per request, and `tools/reembed.mjs` to make the calls in order. One difference from the fix first proposed: the fingerprint is not compared batch by batch. Each staged row keeps the fingerprint it came with and the swap compares them all, so a run abandoned under one model cannot block a later run under another. What is still unmeasured is the CPU cost of one embedding, which phase 4 measures. It now sets the batch size and no longer decides whether the pool can be re-embedded at all. The same measurement bears on `commons-contribute` (see "Limits" under Edge Functions).

2. **Fixed. `supabase/config.toml` had no `project_id`.** Confirmed against Supabase's configuration reference, which lists `project_id` as required with no default. Added.

3. **Fixed. Some refusals came back as raw database errors.** Confirmed for `contribute_decomposition`, whose conversion of `principle_id` ran before the block that turns refusals into questions, and for the conversions of `criterion_id`, `order` and the embeddings inside that block, which it did not catch. `contribute_verdicts` made its conversions inside its block but caught only its own refusals. Fix: both functions, and `stage_clause_embeddings`, now turn any Postgres error of class 22 (a value not in its proper form) into a question, and `clause_search` answers an unknown role with an empty reply and a question. What stands: an argument declared with a type is converted by PostgREST before the function starts, so it cannot be caught inside the function. That leaves `retire`'s id, and `clause_search`'s embedding and limit. `commons-search` now checks the role and limit itself, the embedding is made by the function and never by the caller, and `retire` is called only from Probanda's development machine, so no reply to a user's machine is affected.

4. **Stands until phase 4. Which headers an Edge Function call may carry.** The plugin's client (`source/probanda/commons-mcp/src/legal-commons/client.ts`) sends the secret key in both `apikey` and `Authorization: Bearer`. Supabase's migration guide says the Edge Function platform rejects a secret key in the Bearer header as an invalid JWT. Whether that applies with `verify_jwt = false` is not stated, and nothing but a call to a deployed function can settle it. Phase 4's check does; if the two-header form is rejected, the phase 7 tool sends `apikey` alone, as `_shared/pool.ts` already does for its own calls.

5. **Stands until phase 4. No platform log keeps the text a search carries.** The Edge Functions log nothing themselves, but Supabase keeps request logs for Edge Functions and for the API, and whether either records a request body can only be seen on a deployed function. A query text sent from a user's machine is held in memory for the call; if a platform log stored it, that would be User Data saved to Probanda's cloud (Commandment 3). Phase 4's check now includes it: a test call carries a marker string, and the project's Edge Function and API logs are read for the marker. If it is found, `commons-search` is not given to the plugin until the logging is turned off or the design changes.

6. **Settled. The scratch-test builder runs on the executing machine.** `node --version` on the development machine gives 22.23.2, above the 22.18 the builder needs, and the builder ran.

7. **Settled as to where, open as to which. The pilot decompositions.** They exist, as five decomposer runs and three checker runs in the maintainer's working folder. Which run Brahm approves is the phase 5 gate.

## Findings from the review before phase 3, 2026-10-13

A second model read the three SQL files and the plugin's client code before the pool was changed, and advised going ahead. Its procedural points are in phase 3 above. None of the following stops phase 3. Each is settled before the phase named.

8. **Settled 2026-10-13, no change. A very long clause gets a database error, not a question.** `clause.text_key` is unique through an index, and Postgres refuses an index entry longer than about 2,700 bytes with an error that is not of class 22, so `contribute_decomposition` would pass it on raw. Measured across all five pilot runs: the longest statement is 401 bytes (66 words), under a sixth of the limit, so no length check is added. A later statement over the limit would get the database's error, and it would reach only Probanda's development machine, the one place `commons-contribute` is called from.
9. **Settled 2026-10-13, no change. Reading aids are written once per consequence clause.** `contribute_decomposition` adds `clause_part` rows only when the consequence has none, so contributing a corrected decomposition with the same consequence wording does not correct its actor, discretion or polarity. Checked across all five pilot runs: no consequence wording appears with two different sets of reading aids, so the 16 load the same way whichever run is approved, and phase 5 loads each principle once. Correcting the aids of a pooled consequence later needs a write that no function offers yet.
10. **Noted. A reused clause keeps its stored embedding.** The embedding sent for a clause that is already pooled is discarded. That is right while one model is in use, which the fingerprint enforces.
11. **Noted, for phase 7. `clause_search` takes an embedding of any length.** One of the wrong length gets the database's own error. `commons-search` is the only caller and makes the embedding itself.
12. **Noted. Three existing tools' replies gain a field.** `amend_authority_edge`, `link_authority` and `unlink_authority` return the whole `principle_authority` row, which now includes `pinpoint`, empty. Nothing reads the shape of those replies.
