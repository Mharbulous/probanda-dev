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

The three reading aids are the ones `GLOSSARY.md` describes under Consequence. A simple consequence has one part. A compound consequence has one part for each actor that has its own main verb, so two linked outcomes of one actor are one part (Brahm's decision, 2026-10-13). A clause used only as a condition or a rationale has no parts. This departs from the schema plan's Design table, which put the three aids on the clause. See default 1.

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

Limits that bear on this, from Supabase's documentation read 2026-10-13: an Edge Function may use 2 seconds of CPU time per request, 256 MB of memory, and on the free plan may run for 150 seconds in all before it is shut down. The 150 seconds is how long one worker stays alive, and the 2 seconds counts only time on the CPU, not time spent waiting on the database. Supabase's documentation does not say whether running the built-in model counts toward the 2 seconds. Phase 4 measured about 140 ms of elapsed time for each embedding and a successful request of 12, and did not read the CPU time. Each function is built so that the answer changes a number and not the design: `commons-search` embeds one text. `commons-reembed` embeds one batch per request, and the batch size is an argument of the request, so it is lowered until a batch fits, down to one clause. `commons-contribute` embeds every statement of one principle in one request and cannot be split, because a decomposition is saved whole or not at all. If phase 4's measurement shows the largest pilot decomposition does not fit, the fix is to have the function embed in a first request and write in a second, and phase 5 waits for it.

## Defaults taken, each of which Brahm can reverse

1. **Reading aids are recorded once per part of a consequence**, not once per clause. Brahm's reading of pilot principle 4 is one compound consequence with two actors, and one actor field cannot hold that. Reversing this folds `clause_part` into three fields on `clause`.
2. **Obiter is recorded on the stated-in link, and left empty by this migration.** Nothing in the pool says which test of a principle an authority's `obiter` flag was about, so copying it would be a guess. `principle_authority.obiter` stays where it is. Neither field can say "this decision supports this one test of that principle". That would need a three-way link of test, principle and authority, and no existing row holds the information to fill one, so it is not built.
3. **The six `criterion` fields with no place get no new field** (`burden_of_proof`, `authority_id`, `in_force_date`, `repeal_date`, `treatment`, `treated_by_authority_id`). They stay on the old row, reachable through `conversion_record`. `repeal_date` is never turned into a retired date, because a retired date marks a mistake and a repeal does not.
4. **Nesting is not given a pointer.** `criterion.determined_by_principle_id` is recorded in `conversion_record` as its old row. The link between an outer test's element and an inner test's consequence comes from the shared clause or a meaning verdict.
5. **A principle that has tests cannot be deleted.** The foreign key from `test_principle` refuses it. The client code deletes rows only from `principle_authority` and `authority`, so no plugin tool deletes a principle today. A merge of two principles, which would write `principle_redirects` and remove a row, exists in no tool and could only be done by hand in the SQL editor. Phase 1's dump confirms that no database function or policy deletes one either.
6. **Testing uses a scratch schema in the live project.** This machine has neither Docker nor the Supabase command-line tool (both checked 2026-10-13), so a local copy of Supabase cannot run here. The scratch schema holds empty copies of the existing tables and the new objects, touches no pool row, and is dropped afterwards. It is still a write to the live project and waits for the phase 2 go-ahead. The alternative is installing Docker Desktop and testing locally. Embeddings in the scratch tests are any 384 numbers, since the Edge Functions are not deployed until phase 4. Since this default was written, the same tests have passed in PGlite on the development machine (phase 2 below), which changes what the scratch run adds. The phase 2 gate puts that choice to Brahm.

## Needed from outside the repository

The remaining phases rest on files that are not in this repository. None may be committed here, and no path from the maintainer's machine may appear in this plan. The executing session asks Brahm where each folder is, and confirms each file is at hand, before the phase that needs it.

- **The trial's results** (`results.json` in the maintainer's `gte-small-trial` working folder): 747 pairs under `runs.q8.pairs.positives`, each an original clause (`a`, with the clause's id in `id`) and a rewording of it (`b`) that the earlier rounds judged to mean the same. The 681 with an `evidence` value other than `end points` are the rewordings the trial searched with. Needed at phase 5. The trial's `trial.mjs` and `report.md` were needed at phase 4, which is done.
- **The link from a trial clause to its principle**, which the trial's own files do not hold. It is in the maintainer's `semantic-compression-test` working folder: `clauses.json` gives each clause id its text, its `slots` (`conclusion` marks a consequence) and its `atoms`, labels such as `1.1` whose first number is the principle's number, and `principles.json` gives each principle number its pool id. Checked 2026-10-13: joining the three files gives exactly 443 rewordings of consequences, no clause belongs to two principles, and the 16 pool ids are the ids `runA4` carries. Needed at phase 5.
- **The approved pilot run**, `runA4`, in the maintainer's working folder for the schema plan's step 3: `decomposition.json` (36 records from the 16 principles, 64 distinct clauses once tidied, 37 conditions, 3 rationales), `decomposer-brief.md` and `checker-brief.md` (the instructions that made and checked it) and `review-runA4.md` (the review Brahm read). Needed at phases 5 and 6.
- **The scratch scripts** in the maintainer's `pool-phase5` working folder: `export_pool.mjs` (a read-only export of the pool's `principle`, `criterion` and `principle_authority` rows, run by Brahm with the key) and `build_payloads.py` (builds the file `tools/contribute.mjs` takes). The files phases 5 and 6 make (the export, the conversion mapping, the payloads, the search queries and results, the clause export, the pair batches and the verdicts) are written to the same folder, and never to this repository.
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
- Deployed 2026-10-13, after Brahm logged the command-line tool in: `supabase functions deploy --use-api --project-ref <the project> --workdir cloud/legal-commons` deployed all three functions at version 1, each listed as active with JWT verification off. A request to `commons-search` with no `apikey` header was refused with 401. No fingerprint is stored yet, and no call carrying a key has been made.
- Result of `tools/check_functions.mjs`, run by Brahm on 2026-10-13: every check passed. Each of the three functions refused a request with no `apikey` header and a request with the publishable key, with 401. With the secret key in `apikey` alone, `commons-search` returned `{"exact": null, "nearest": []}`, `commons-contribute` answered an empty payload with a question, and `commons-reembed` answered the request to finish with `{"model": "gte-small", "saved": true, "clauses": 0}`, so the fingerprint is stored. A call to `commons-search` with the secret key in both `apikey` and `Authorization: Bearer` was accepted (finding 4).
- The 20 strings against the local model: the hosted model scores 1.000000 against the full-precision form (`fp32`) on every string, and between 0.997809 and 0.999186 against the compressed form (`q8`), which are the same figures the two local forms score against each other. The hosted model is therefore the full-precision model. Brahm's decision, 2026-10-13: the check is recorded as passed against `fp32`, and the pass mark stays 0.999. The trial's own figures were made with `q8`, so they describe a model that differs from the hosted one by up to 0.0022 in cosine similarity. Phase 5's recall check runs through the hosted function and measures the hosted model directly.
- Timings, from the caller's clock and so including the network: requests of 1, 1, 2, 4 and 12 embeddings took 266, 304, 423, 677 and 1,741 ms, which is about 140 ms for each embedding on a running worker. The request of 12 succeeded. The CPU time was not read off the dashboard, so how close 12 embeddings come to the 2 seconds is not known, nor whether the model's work counts toward it. Decided from this: `commons-reembed` keeps its batch of 10 (11 embeddings with the fixed sentence, fewer than the 12 that fit), and `commons-contribute` stays one request, because the largest pilot decomposition needs exactly the 12 that fit. A later decomposition with more statements has no measured room, and if its request fails the fix is the one under "Limits".
- The marker sent as a search was `probanda-log-marker-3c969ffd5b1c`. The log records Brahm read hold no request body and no marker (finding 5). The record of one `commons-search` call gave its time on the server as 717 ms.
- The recall check that the schema plan placed here moves to phase 5, because the `clause` table is empty until then and a search over it can find nothing.
- Undo: delete the three functions in the dashboard. The fingerprint row goes with the tables if phase 3 is undone, or is left in place harmlessly if not.

### Phase 5. Load the decompositions (gate passed 2026-10-13: Brahm approved `runA4`)

Who does what, in this phase and the next two. The executing session has no route into the pool. It never reads, prints or holds the secret key. Every step that reaches the pool is Brahm's: SQL he pastes into the SQL editor, or a Node script he runs in his own PowerShell with the key in the environment variable `POOL_SECRET_KEY`. No script prints the key. He pastes the printed output back, and the session reads it. The session writes the files and scripts, reads the outputs and dispatches the agents. A "payload" below is the JSON document that `contribute_decomposition` takes, whose shape is set out at the top of that function in `consequence_functions.sql`.

- Gate: passed. Brahm reviewed the pilot run `runA4` and approved it for loading on 2026-10-13 (see "Before the load", item 5). No further go-ahead from him is needed for the writes of phases 5 and 6. The session confirms the run's files are at hand before it starts (see "Needed from outside the repository").
- Phase 1 found no principle beyond the 16. A principle pushed later is decomposed and contributed, in batches, by the same two-agent pipeline as the pilot. A person reviews every checker flag and one in ten of the rest. The queries in step 5 are re-run after each such batch.

Steps, in order:

1. **Export the old rows** (Brahm). In his PowerShell, with `POOL_SECRET_KEY` set: `node export_pool.mjs <export file>` in the `pool-phase5` folder. The script only reads. Expected output: `16 principles, 35 old condition rows, 14 authority links`. Any other count stops the phase, because those are phase 1's counts and the pool should not have changed since.

2. **Write the conversion mapping** (the session, then a reviewer). The file `conversion.json`, in the `pool-phase5` folder, has one entry for each of the 35 `criterion` rows: `{"criterion_id", "test", "clause_text", "reason"}`, each of the last three filled or `null`. The target is `clause_text` when a clause of the same principle in `decomposition.json` states the same condition. It is `test` (the record's label, such as `"3.1"`) when the new decomposition kept the condition's words inside a record's consequence, as its rule 6 does for a phrase that says how the outcome happens. Otherwise it is a `reason`, one sentence saying what the new decomposition did with the point: for example that the old row stated something the prose does not, or that the old row combined two conditions that `runA4` holds as two elements, in which case the first is the target and the reason names the second. Matching is on meaning, not word for word, and never on what the law is: the mapping says which new wording carries the old row's point, and not which wording is correct.
   - Phase 1 found six old rows typed `factor`. `runA4` has no factor (its 37 conditions are 28 elements and 9 exceptions, 24 and 6 distinct wordings), so each of the six maps to an element or to a reason. The mapping lists the old type beside the new one for every entry.
   - Review: the session gives the mapping, as a table of old wording, new wording or reason, old type and new type, to a second model with read access only, at least as strong as the session's own model, which reads each entry against the principle's prose and reports every doubtful match. The session corrects those. Brahm reads only the entries that end in a reason and the six type changes, and says whether any is wrong.
   - Check: step 3 accepts the file.

3. **Build the payloads** (the session). In the `pool-phase5` folder: `python build_payloads.py decomposition.json <export file> conversion.json payloads.json`. The script refuses unless there are 16 payloads, every one of the 35 `criterion` ids appears in exactly one entry, every entry's target is a record label or a clause wording of its own payload, and every entry has a target or a reason. Expected output: `16 payloads, 36 records, 35 conversion entries, largest principle 9 statements`, then `wrote payloads.json`. The 9 counts distinct wordings. `commons-contribute` embeds each statement as it appears in the payload, repeated consequence wording included, so principle 15's request embeds 11 statements and the fixed sentence: the 12 that phase 4 measured as fitting one request. No payload is larger (counted 2026-10-13).

4. **Contribute** (Brahm). In his PowerShell, in the repository's `cloud/legal-commons` folder, with `POOL_SECRET_KEY` set: `node tools/contribute.mjs <payloads.json> probanda-development`. The last word is the contributor label stored on each record. It is a label for the development machine and not a person's name, and Brahm may name another. The script sends one principle per request to `commons-contribute`, which embeds the statements and the fixed sentence and calls `contribute_decomposition`. Expected output: 16 lines `saved <principle id>  <n> test(s), <n> new`, then `16 principle(s) saved, 36 new test(s)`. No clause of `runA4` is shared by two principles (checked 2026-10-13), so the load makes 36 records and 64 clauses whatever the order.
   - If a principle is refused, the script prints `NOT SAVED <principle id> <status> <reply>` and stops. The reply is the function's one question, for example "Is the wording each conversion record points at a statement in this decomposition?". The principles before it are saved and stay saved. The session fixes the payload (or the mapping, and rebuilds), and Brahm runs the same command again on the whole file. A principle already saved is matched record by record by its clause ids and adds nothing (`0 new`), so the re-run is safe.
   - If a saved record proves wrong after the load, it is retired, never deleted: `retire('test', <test id>, <note>, <contributor>)`. No Edge Function and no script reaches `retire` today. It is called through PostgREST (`POST /rest/v1/rpc/retire`, headers `apikey` and `Content-Profile: legal_commons`). When first needed, the session writes `tools/retire.mjs`, which takes the kind, the id and the note and prints the reply, and Brahm runs it. The corrected record is then contributed again in a payload of its own. The retired record's clauses stay in the pool, and a consequence's reading aids cannot be changed once stored (finding 9).

5. **Check the load with queries** (Brahm pastes each into the SQL editor and pastes the result back). No file holds these, so they are given here. Each only reads.

   a. Row counts. Expected: `clause` 64, `test` 36, `test_clause` 37, `test_principle` 36, `conversion_record` 35, `meaning_verdict` 0, `test_rationale` 4 (the three rationales attach to four records), and `clause_part` between 31 and 37 (the parts of the 31 distinct consequences, written once per consequence clause, where the 36 records have 37 parts in all).

      ```sql
      select 'clause' as t, count(*) from legal_commons.clause
      union all select 'clause_part', count(*) from legal_commons.clause_part
      union all select 'test', count(*) from legal_commons.test
      union all select 'test_clause', count(*) from legal_commons.test_clause
      union all select 'test_principle', count(*) from legal_commons.test_principle
      union all select 'test_rationale', count(*) from legal_commons.test_rationale
      union all select 'conversion_record', count(*) from legal_commons.conversion_record
      union all select 'meaning_verdict', count(*) from legal_commons.meaning_verdict;
      ```

   b. Every principle has a record, or a conversion record about the principle as a whole with a reason for none. Expected: no row.

      ```sql
      select p.principle_id
      from legal_commons.principle p
      where not exists (select 1 from legal_commons.test_principle tp where tp.principle_id = p.principle_id)
        and not exists (select 1 from legal_commons.conversion_record r
                        where r.principle_id = p.principle_id and r.criterion_id is null and r.reason is not null);
      ```

   c. Every old condition row has a conversion record. Expected: no row.

      ```sql
      select c.criterion_id
      from legal_commons.criterion c
      where not exists (select 1 from legal_commons.conversion_record r where r.criterion_id = c.criterion_id);
      ```

   d. Every record has a stating principle. The write function always makes the link, so this catches only a hand edit. Expected: no row.

      ```sql
      select t.test_id from legal_commons.test t
      where not exists (select 1 from legal_commons.test_principle tp where tp.test_id = t.test_id);
      ```

   e. Authority links of principles that have no record, listed for Brahm, because those authorities reach no record and only he can say whether that is right. Every principle of `runA4` has at least one record, so on this load the expected result is no row. It matters for later batches.

      ```sql
      select pa.principle_id, pa.authority_id
      from legal_commons.principle_authority pa
      where not exists (select 1 from legal_commons.test_principle tp where tp.principle_id = pa.principle_id);
      ```

   f. No record is stale right after the load. Expected: no row.

      ```sql
      select tp.test_id, tp.principle_id
      from legal_commons.test_principle tp
      join legal_commons.principle p on p.principle_id = tp.principle_id
      where tp.principle_text_md5 is distinct from md5(p.text);
      ```

6. **The search check** (the session writes the input and the script, Brahm runs it, the session reads the result). This is the first search over real pooled clauses, and the hosted model is measured directly.
   - What is searched with: the 443 rewordings of consequences from the trial, each with the pool id of the principle its clause came from. The link is made from the trial's `results.json` and the `semantic-compression-test` folder's `clauses.json` and `principles.json`, as "Needed from outside the repository" sets out. The trial's own files do not carry it, so the sentence this plan had, that the source principle "is known from the trial's files", was wrong as written.
   - What the check measures, and what it cannot. The trial's clauses and `runA4`'s were cut from the same 16 principles by different hands. Only 1 of the trial's 48 consequence clauses appears word for word in `runA4` after tidying, and the trial has 48 consequences where `runA4` has 31 (principle 14 has 9 against 3). So the check asks whether a search for a rewording lands on a clause of the right principle, not on one particular clause. The queries are also uneven: principles 14, 15 and 16 supply 234 of the 443, and principle 6 supplies one. The result is therefore reported per principle as well as overall.
   - Rank, and the pass mark. A reply lists hits in order, `exact` first if any, then `nearest`. A hit is "from" a principle when any record in its `tests` list has that principle in `stated_in`. A query's rank is the position of the first hit from the right principle, with `exact` counted as position 1, or "not in the top 10". Principle 3 is recorded as a variant of principle 2 (the one `variant_of` pair among the 16), so for a query from either, a hit from either counts. The plan asked for a hit from the right principle in the top 10 in 95% of queries. With 64 clauses and 16 principles, about four clauses each, a random order would put a clause of the right principle in the top 10 about half the time, so that mark could hardly fail and is replaced. Pass mark: rank 1 in at least 90% of the 443, and rank 3 or better in at least 95%. A random order gives about 6% and 17%.
   - A second check that can fail only on the search itself: each of the 64 pooled wordings, sent as its own text, comes back as `exact`. Expected: 64 of 64.
   - Below the mark: the session reads every query ranked worse than 3 and sorts it into two kinds. Either `runA4` has no clause that says what the trial's clause said, so no hit from the right principle could be expected, or the search ranked clauses of other principles above a clause that says the same. Only the second kind counts against the search. If the second kind alone takes the figure below the mark, phase 6 waits until Brahm has read those queries and said how to go on.
   - How it is run. The session writes `recall_queries.json` in the `pool-phase5` folder: a list of `{"id", "text", "principle_ids", "expect_exact"}`, the 443 rewordings (`expect_exact` false) and the 64 pooled wordings (`expect_exact` true). The session writes `tools/recall_check.mjs` in the repository, beside `contribute.mjs`. It takes the queries file and an output path, reads the key from `POOL_SECRET_KEY`, and sends each query to `commons-search` as `{"text": ..., "role": "any", "limit": 10}` with the key in the `apikey` header, one request at a time. For each reply it records the rank as defined above and whether `exact` was returned, writes every query's id, rank and the ids of its hits to the output file, and prints the counts at rank 1, rank 3 or better, rank 5 or better, rank 10 or better and not found, overall and per principle, with the pass marks marked passed or failed, and the exact count. It prints no key and no clause text. Brahm runs it in his PowerShell, in `cloud/legal-commons`, with `POOL_SECRET_KEY` set: `node tools/recall_check.mjs <queries file> <output file>`, and pastes the summary back. The session reads the output file for the misses.
   - Cost. 507 requests of one embedding each. Phase 4 measured about 0.7 s on the server for one search, so about six minutes in all. Supabase's pricing page (read 2026-10-13) gives the free plan 500,000 Edge Function calls a month and no cap on Data API requests, and the 2 seconds of CPU time per request is for one embedding per request, which phase 4 ran twelve of. The texts sent are rewordings of pooled principles and no user's data, and phase 4 found that no platform log keeps a request body (finding 5).

#### Before the load: propositions and tests (decided 2026-10-13)

What led here. A second model reviewed the pilot run `runA3` and advised against loading it, because the decomposer's instructions had changed since it was made. Brahm then settled three points (a new part of a consequence begins only with a new actor, a "may" that states only what is possible is not discretionary, and a "who" or "that" phrase stating a fact the outcome turns on is an element), and a fresh run, `runA4`, was made and checked: 36 records, no finding of high severity. On reading it Brahm found that 15 of the 36 have no element and no factor (13 have no condition at all, and two, `14.1` and `15.1`, have exceptions only), and said those are propositions and not tests.

Brahm's decisions:

- A **proposition** is the general term: a consequence, with whatever conditions the authority states for it, which may be none. A **test** is a proposition with two or more elements or factors. Exceptions are not counted. On `runA4` that makes five of the 36 records tests (`8.1`, `8.2`, `10.1`, `10.2`, `10.3`) and 31 propositions.
- The pool stores both in the one structure it has, and the label is worked out from the count when a record is shown. Two structures were considered and not chosen, because the dividing line is a count that a corrected decomposition can change: a record would have to move between them, each of the four links that point at a record would need two targets, and the search and the "already pooled" comparison would each run twice.
- A phrase with no verb of its own, such as "On application", stays in the consequence. Making it an element would add words the prose does not use.
- A definition stays one record in the prose's words. Writing one record for each thing a definition lists was tried on principle 14 and gave five records in words the prose does not contain.

Two rules proposed earlier the same day were therefore dropped, and the instructions that produced `runA4` stand. No new run is needed.

The database does not change, and this was checked against the files as committed. The write function `contribute_decomposition` treats a record's list of conditions as optional, and no table rule requires a condition. One of the 39 tests saves a decomposition whose records have no condition. The search returns an empty `conditions` list for such a record. Phase 5's queries, phase 6's candidate pairs and the recall check all start from a record's consequence clause, which every record has. The table keeps the name `test`, and so do `test_id`, the payload keys `tests` and `test`, and the reply field `tests_made`. In this plan, "test" in any of those names, and in the prose outside this section, means a record of any size.

Done on 2026-10-13:

1. A refusal of a record with no element or factor, written into the SQL before the decision and never committed or applied, was removed. Check: `git status` lists neither SQL file, and the PGlite run passes 39 of 39.
2. `GLOSSARY.md`: Proposition and Test were replaced, and Clause, Consequence, Element, Exception, Factor, Rationale, Rule, Principle, Ratio decidendi and Defence now say "proposition" for the record of any size.
3. The decomposer's and checker's instructions, in the maintainer's working folder, define a proposition and a test in the glossary's words, say that a record with no condition is allowed, and say that no condition is ever supplied to fill one.
4. The review file of `runA4` heads each record "Proposition" or "Test" by its count. Check: five records are headed "Test", the five named above.
5. **Brahm reviewed `runA4`, and approved it for loading on 2026-10-13**, all 16 principles. This was the phase 5 gate, and the approval is the go-ahead for phase 5's writes. Before he decided, a second model read all 36 records against the prose and found nothing of high severity: no record says something the prose does not, and none loses something it says, apart from the link words "separately", "same" and "instead" in principle 16. It found each of the checker's medium findings to be a breach of the letter of a rule where the decomposer's choice matches the prose better. Two corrections were made by hand to the run's reading aids, because a reading aid cannot be corrected once loaded (finding 9): record `2.1`'s actor is "A plaintiff" and `2.5`'s is "A claim", where the run had the rule number, and `2.5` is not discretionary. Principle 16's reason stays on `16.3` alone, because the prose joins it by "and so" to that one outcome. The decomposer's instructions were then changed for later runs to say what `runA4` does: the actor of a statement whose subject is a rule is the person or thing the rule acts on, a reason attaches only to the records the prose joins it to, a thing is named by its first-mention phrase as far as the words that say which thing is meant, and a thing the prose never names is named by the shortest phrase built from the passage it points at.

Still to do before the load:

6. **Build the payloads and the conversion records**: steps 1 to 3 of phase 5 above. `decomposition.json` is not in the shape `contribute_decomposition` takes: its `test` key is the payload's `ref`, its `leans_on_outside_text` list is not sent, and it has no `conversion` list. `build_payloads.py` makes the change of shape. The conversion list needs the ids of the 35 `criterion` rows, which are in the pool only, so Brahm's export comes first.
7. **Phase 7.** Whether a search reply shows a record's conditions at all is phase 7's gate question. If it does, the plugin labels each record "proposition" or "test" by its count of elements and factors, and the label is derived when shown, never stored.

### Phase 6. Judge meaning (no further gate)

The pool links two clauses that mean the same (a pair in the state `equivalent`) so that the search can follow the link from one to the other. The judgment is made by the `equivalence-checker` agent (`source/probanda/agents/equivalence-checker.md`) and stored as verdicts. The agent takes one JSON file holding a list of `{id, a, b}` pairs of clause texts, judges each pair on its own, and writes one JSON file holding, for each pair, `forward` (does `a` imply `b`), `backward` (does `b` imply `a`), a `verdict` derived from the two, and a one-sentence `reason`. It always answers both directions and never declines a pair, so there is no undecided pair. It states no law and never touches the pool.

Steps, in order:

1. **Export the clauses** (Brahm). The session writes `export_clauses.mjs` in the `pool-phase5` folder, on the pattern of `export_pool.mjs`: a read-only script that reads, through PostgREST with `Accept-Profile: legal_commons`, the `clause` rows (`clause_id`, `text`, `embedding`), the `test` rows (`test_id`, `consequence_clause_id`), the `test_clause` rows (`test_id`, `clause_type`, `clause_id`) the `test_rationale` rows (`clause_id`) and the `test_principle` rows (`test_id`, `principle_id`), and writes them to a file. The last was added when the script was written on 2026-10-13: step 2 pairs the consequences of principle 3 with those of principle 2, and nothing else in the export says which principle states a record. PostgREST returns an embedding as text, `[0.0123,...]`, which the script turns into 384 numbers. Brahm runs it with `POOL_SECRET_KEY` set. Expected output: `64 clauses, 36 records, 37 conditions`.

2. **Choose the candidate pairs** (the session, with no key). From the exported embeddings the session computes the cosine similarity of every pair of the 64 clauses, 2,016 pairs, on the development machine. The candidates are every pair scoring 0.90 or more, whatever role each clause has, plus every pair of a consequence of principle 3 with a consequence of principle 2, the one `variant_of` pair among the 16. Why 0.90: in the trial, 0.3% of pairs that meant the same scored below 0.90, and 4.2% of pairs of different clauses scored at or above it, so about 85 pairs that mean something different are expected among the candidates, together with the pairs that mean the same. Why every role: default 4 says the link between an outer record's element and an inner record's consequence is made by a meaning verdict, which a same-role rule, as this phase was first written, would never make. Why not "the nearest 10 of each clause through `commons-search`", as first written: 10 of 64 is a sixth of the pool for every clause, 640 ordered pairs, most scoring near 0.80 where the trial found no pair that meant the same, the function returns no score to cut them by, and it would cost a request per clause. Each pair appears once: `a` is the clause with the smaller id and `b` the larger, so (A, B) and (B, A) are one entry, and the entry's `id` is the two clause ids joined by `|`. The session writes the pairs as `[{id, a, b}]`, with the clause texts, in batches of 25 to files in the `pool-phase5` folder, and keeps the table from `id` to the two clause ids. The trial's constructed near misses (may for must, a negation added or removed, two actors swapped) all scored 0.915 or more, which is why a judge reads every candidate.

3. **Judge** (the session dispatches the agent). One `equivalence-checker` instance per batch, in parallel if wanted, each with `{"input_path", "output_path"}`. Each writes its output file and replies with one line of counts. Check: every batch has an output file, every entry's `id` is one of the batch's ids and each appears once, and every `verdict` matches its two booleans (`equivalent` only when both are true).

4. **Build the verdicts file** (the session). One entry per pair: `{"clause_a": a's id, "clause_b": b's id, "a_implies_b": forward, "b_implies_a": backward, "judge_kind": "model", "judge_model": ..., "judge_prompt_version": ...}`. `judge_model` is the full name of the model the agent ran on, as the session's harness reports it at dispatch (the agent definition pins the family `opus` and not a version). `judge_prompt_version` is the short hash of the last commit that changed the agent's definition, from `git log -1 --format=%h -- source/probanda/agents/equivalence-checker.md` (`c0f572e` as this is written). The agent's `reason` has no field in the pool and stays in the output files in the working folder.

5. **Store the verdicts** (Brahm). No Edge Function reaches `contribute_verdicts`. It is called through PostgREST: `POST /rest/v1/rpc/contribute_verdicts`, headers `apikey`, `Content-Type: application/json` and `Content-Profile: legal_commons`, body `{"p_verdicts": [...], "p_contributor": "probanda-development"}`. The session writes `tools/contribute_verdicts.mjs` in the repository, beside `contribute.mjs`: it takes the verdicts file and the contributor, reads the key from `POOL_SECRET_KEY`, makes the one call and prints the reply. Brahm runs it in `cloud/legal-commons`. Expected reply: `{"saved": true, "verdicts": N}` with N the number of candidate pairs. The call is all or none: a refusal is one question, the file is fixed and the call made again. A file that was saved is not sent again, because the function has no duplicate check and would store every verdict twice, which changes no pair's state but doubles the rows.

6. **Check** (Brahm pastes, the session reads).

   ```sql
   select state, count(*) from legal_commons.clause_pair_state group by state;
   ```

   Expected: the counts add up to the number of candidate pairs, and no row has the state `conflict`. With one model verdict per pair, no pair can be in `conflict`, because that state needs verdicts that disagree, so the check "every pair in conflict is listed for Brahm" cannot fail here. It applies once a pair has a second verdict. What is listed for Brahm instead is every `equivalent` pair, with both texts, because an equivalent link changes what a search returns and only a person's verdict overrides a model's. He gives his verdict on any pair he disagrees with through the same script, as an entry with `"judge_kind": "person"` and no model fields. A verdict is never deleted; a wrong one is retired, as a record is.

### Phase 7. Give the plugin the search (step 8 of the schema plan, unchanged)

One read tool that calls `commons-search`. Phase 4 found that a call is accepted with the secret key in `apikey` alone and also with it in both `apikey` and `Authorization: Bearer`, the shape the plugin's client sends today, so the tool may use the client's existing headers unchanged. The tool sends the text in the body of a `POST` request and never in the address, because Supabase's API log keeps the address of every request and not its body (phase 4, finding 5). The plugin's existing `browse` tool puts its keyword in the address of a `GET` request, where that log keeps it; this plan does not change `browse`, and the new tool must not copy it. No pool table, column or function name appears in any skill or agent file, or under `plugins/` or `public/` (checked 2026-10-13: none does). The plugin writes nothing from a reply to disk, neither text nor id (Exception 1). The tool labels each record in a reply "proposition" or "test" by its count of elements and factors, derived when shown and never stored, if the reply shows conditions at all. Releasing the tool is a push to `main` with the version bumped, as `CLAUDE.md` sets out.

Gate question for Brahm, the one the schema plan's "Not goals" left to this step: what may the tool show a user of a search reply? A reply holds, for each hit, the clause's text and its reading aids, every record it belongs to with that record's conditions and their types (element, exception, factor), rationales, stating principles with their stale mark, every clause linked to it as `equivalent` with those clauses' records, and the clauses it is in `conflict` with. Together those are the structure of a rule. Today's `resolve_by_id` already sends a principle's criteria with their types to a user's machine, under Exception 4. The choices are: show the whole reply, which relies on Exception 4 exactly as today's tools do; show only the clause texts and the principle ids, so the rule's structure stays in the cloud (Commandments 4 and 5 are then not in question, and the user follows a principle id to the prose as today); or something between, which Brahm names. Until he answers, no tool is built.

## Undoing it

Phases 3 and 4 are undone by `0001_down.sql` and by deleting the three Edge Functions. Because nothing existing was changed, the pool is then exactly as it was, apart from the `pinpoint` field, which the down script also removes together with anything it held. Phases 5 and 6 only add rows to the new tables, which go with the tables if the down script is run, and that is the only way they are removed: a wrong record or verdict is otherwise retired, never deleted, and the load itself leaves a refused principle unsaved and the rest in place. Phase 7 is undone by removing the tool and releasing the plugin again, and must be undone first, because a released tool that calls a deleted function fails for every user.

## Out of bounds

As the schema plan states them: no write to the live project and no deployed function without Brahm's go-ahead at that phase, no allowlisting of `legal_commons__*`, no reading or printing of the credential, nothing under `cloud/` copied into `plugins/` or `public/`, and no statement of what the law is. For phases 5 to 7 in particular: the session never reads, prints or holds the secret key, and no script it writes prints it; no pool row is deleted, a wrong record or verdict is retired; no pool table, column or function name goes into any skill or agent file or under `plugins/` or `public/`; and the conversion mapping and the pair judgments compare wordings and never say which wording is correct.

## Findings from the review of 2026-10-13, and what became of each

Found by reading the built files against this plan and Supabase's documentation. Each was then checked against the code and the documentation again, the same day, and either fixed or left standing with the reason.

1. **Fixed. `commons-reembed` could not fit in one Edge Function run.** Confirmed: the function embedded every clause in one request, `set_clause_embeddings` refused any call that left a clause out, and Supabase's limits page (read again 2026-10-13) gives 2 seconds of CPU time per request, 256 MB of memory, and 150 seconds as the life of a worker on the free plan. The page gives no limit on the size of a request. Fix: the `clause_embedding_staging` table, the `stage_clause_embeddings` function, a `set_clause_embeddings` that swaps from the staged rows and keeps its all-or-none rule, a `commons-reembed` that embeds one batch per request, and `tools/reembed.mjs` to make the calls in order. One difference from the fix first proposed: the fingerprint is not compared batch by batch. Each staged row keeps the fingerprint it came with and the swap compares them all, so a run abandoned under one model cannot block a later run under another. What is still unmeasured is the CPU cost of one embedding, which phase 4 measures. It now sets the batch size and no longer decides whether the pool can be re-embedded at all. The same measurement bears on `commons-contribute` (see "Limits" under Edge Functions).

2. **Fixed. `supabase/config.toml` had no `project_id`.** Confirmed against Supabase's configuration reference, which lists `project_id` as required with no default. Added.

3. **Fixed. Some refusals came back as raw database errors.** Confirmed for `contribute_decomposition`, whose conversion of `principle_id` ran before the block that turns refusals into questions, and for the conversions of `criterion_id`, `order` and the embeddings inside that block, which it did not catch. `contribute_verdicts` made its conversions inside its block but caught only its own refusals. Fix: both functions, and `stage_clause_embeddings`, now turn any Postgres error of class 22 (a value not in its proper form) into a question, and `clause_search` answers an unknown role with an empty reply and a question. What stands: an argument declared with a type is converted by PostgREST before the function starts, so it cannot be caught inside the function. That leaves `retire`'s id, and `clause_search`'s embedding and limit. `commons-search` now checks the role and limit itself, the embedding is made by the function and never by the caller, and `retire` is called only from Probanda's development machine, so no reply to a user's machine is affected.

4. **Settled in phase 4, 2026-10-13: both forms are accepted.** With `verify_jwt = false`, a call carrying the secret key in both headers got the same reply as one carrying it in `apikey` alone. As first written: **Which headers an Edge Function call may carry.** The plugin's client (`source/probanda/commons-mcp/src/legal-commons/client.ts`) sends the secret key in both `apikey` and `Authorization: Bearer`. Supabase's migration guide says the Edge Function platform rejects a secret key in the Bearer header as an invalid JWT. Whether that applies with `verify_jwt = false` is not stated, and nothing but a call to a deployed function can settle it. Phase 4's check does; if the two-header form is rejected, the phase 7 tool sends `apikey` alone, as `_shared/pool.ts` already does for its own calls.

5. **Settled in phase 4, 2026-10-13: the marker is in no log record read.** Brahm read the dashboard's logs after the check run. The complete record of the `commons-search` call that carried the marker holds eleven fields (deployment, function and execution ids, the method, the path, the status, the time taken, a timestamp, the version and a one-line summary of method, status and address) and no part of the request's body. The complete record of the function's own call to `clause_search` in the API log holds the method, path, status, time and the caller's user agent, and no body. The list of every log row of the hour showed no database log row for those calls, so the database did not log the statement either. The functions write no log line of their own. Not done: a text search of the logs for the marker, and a reading of the function's Logs tab. As first written: **No platform log keeps the text a search carries.** The Edge Functions log nothing themselves, but Supabase keeps request logs for Edge Functions and for the API, and whether either records a request body can only be seen on a deployed function. A query text sent from a user's machine is held in memory for the call; if a platform log stored it, that would be User Data saved to Probanda's cloud (Commandment 3). Phase 4's check now includes it: a test call carries a marker string, and the project's Edge Function and API logs are read for the marker. If it is found, `commons-search` is not given to the plugin until the logging is turned off or the design changes.

6. **Settled. The scratch-test builder runs on the executing machine.** `node --version` on the development machine gives 22.23.2, above the 22.18 the builder needs, and the builder ran.

7. **Settled as to where, open as to which. The pilot decompositions.** They exist, as five decomposer runs and three checker runs in the maintainer's working folder. Which run Brahm approves is the phase 5 gate.

## Findings from the review before phase 3, 2026-10-13

A second model read the three SQL files and the plugin's client code before the pool was changed, and advised going ahead. Its procedural points are in phase 3 above. None of the following stops phase 3. Each is settled before the phase named.

8. **Settled 2026-10-13, no change. A very long clause gets a database error, not a question.** `clause.text_key` is unique through an index, and Postgres refuses an index entry longer than about 2,700 bytes with an error that is not of class 22, so `contribute_decomposition` would pass it on raw. Measured across all five pilot runs: the longest statement is 401 bytes (66 words), under a sixth of the limit, so no length check is added. A later statement over the limit would get the database's error, and it would reach only Probanda's development machine, the one place `commons-contribute` is called from.
9. **Settled 2026-10-13, no change. Reading aids are written once per consequence clause.** `contribute_decomposition` adds `clause_part` rows only when the consequence has none, so contributing a corrected decomposition with the same consequence wording does not correct its actor, discretion or polarity. Checked across all five pilot runs: no consequence wording appears with two different sets of reading aids, so the 16 load the same way whichever run is approved, and phase 5 loads each principle once. Correcting the aids of a pooled consequence later needs a write that no function offers yet.
10. **Noted. A reused clause keeps its stored embedding.** The embedding sent for a clause that is already pooled is discarded. That is right while one model is in use, which the fingerprint enforces.
11. **Noted, for phase 7. `clause_search` takes an embedding of any length.** One of the wrong length gets the database's own error. `commons-search` is the only caller and makes the embedding itself.
12. **Noted. Three existing tools' replies gain a field.** `amend_authority_edge`, `link_authority` and `unlink_authority` return the whole `principle_authority` row, which now includes `pinpoint`, empty. Nothing reads the shape of those replies.
