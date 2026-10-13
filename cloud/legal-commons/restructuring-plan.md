# Plan: restructure the legal-commons pool for the revised structure

Written 2026-10-13, revised the same day after a review against the files and Supabase's documentation. This is the build plan for the database. The reasons for the design, and the evidence behind it, are in the schema plan ("Plan: consequence-first structure for the legal-commons pool", revision 3, kept in the maintainer's plans folder). This file does not repeat them. Where the two differ, this file is the later one and says so.

Terms are used as the root `GLOSSARY.md` defines them. A few database words recur, and each is defined here once:

- A **migration** is a SQL script applied once to change a database's structure.
- A **foreign key** is a rule that a value in one table must exist in another, so a link can never point at nothing.
- A **view** is a saved query that reads like a table.
- A **uuid** is a random 128-bit number used as an id. A **timestamptz** is a date and time with its time zone.
- An **embedding** is the list of 384 numbers the `gte-small` model makes from a text, placed so that texts with similar meaning get nearby numbers. **Cosine similarity** is the nearness score between two embeddings, from 0 to 1, with 1 for identical.
- An **Edge Function** is a small program that Supabase runs on its own servers, outside the database. Only an Edge Function can run the embedding model.
- **PostgREST** is the web interface through which the plugin reads and writes the pool's tables. **`service_role`** is the database role the plugin's key acts as. A **grant** gives a role the right to use a table or function.

## What changes and what does not

The restructuring is additive. It adds nine tables, one field on an existing table, six database functions and three Edge Functions. It changes no existing column, drops nothing and moves no row. Every tool the plugin has today reads and writes the same tables as before.

| Existing object | What happens to it |
|---|---|
| `principle`, `authority`, `treatment`, `rule_period`, `rule_period_verification` | Unchanged |
| `principle_authority` | Gains one field, `pinpoint` |
| `criterion`, `principle.variant_of`, `principle.variant_note`, `principle_redirects` | Kept and still readable. Nothing in the new structure writes to them. The existing tools go on writing them as they do today: `push_principle` still adds `criterion` rows for a new principle, and `amend_criterion_text` still corrects one |
| The ten existing functions (six in `functions.sql`, four in `rule_periods.sql`) | Unchanged |

One consequence of the last row: a principle pushed after phase 5 arrives with `criterion` rows and no test. It is decomposed later by the phase 5 pipeline, and the phase 5 queries are re-run after each such batch.

## The new tables

All sit in the `legal_commons` schema. Every table has `created_at`. Names below are the names to build.

### `clause`: one self-contained statement

| Field | Type | Rule |
|---|---|---|
| `clause_id` | uuid | Key |
| `text` | text | Required |
| `text_key` | text | The tidied text. Generated from `text` by `tidy_clause_text`. Unique |
| `embedding` | `vector(384)` | Required |

No jurisdiction, no contributor and no type. A clause gets its type from the link that uses it.

Two points of mechanics. `text_key` is a stored generated column, and Postgres accepts a user function there only when the function is declared `immutable` (always the same result for the same input), which `tidy_clause_text` must be. The `vector` type comes from the `vector` extension, which Supabase installs into its `extensions` schema, so the column is declared as `extensions.vector(384)` unless the migration's search path includes that schema, as `functions.sql` already does.

### `clause_part`: the reading aids for one outcome inside a clause

| Field | Type | Rule |
|---|---|---|
| `clause_id` | uuid | Foreign key to `clause` |
| `part_order` | integer | Key with `clause_id` |
| `actor` | text | Free text |
| `discretionary` | boolean | Required |
| `polarity` | text | `affirmative` or `negative` |

A simple consequence has one part. A compound consequence has one part for each linked outcome. A clause used only as a condition or a rationale has no parts. This departs from the schema plan's Design table, which put the three aids on the clause. See default 1.

### `test`: one route to one consequence

| Field | Type | Rule |
|---|---|---|
| `test_id` | uuid | Key |
| `consequence_clause_id` | uuid | Required. Foreign key to `clause` |
| `contributor` | text | The id the contributing install made up for itself |
| `retired_at`, `retired_note` | timestamptz, text | Empty while the test is live |

### `test_clause`: one condition of one test

| Field | Type | Rule |
|---|---|---|
| `test_id` | uuid | Foreign key to `test` |
| `clause_order` | integer | Key with `test_id` |
| `clause_type` | text | `element`, `exception` or `factor` |
| `clause_id` | uuid | Foreign key to `clause` |
| `points_to_test_id` | uuid | Foreign key to `test` |

Rules the table enforces itself: exactly one of `clause_id` and `points_to_test_id` is filled, `points_to_test_id` is allowed only on an exception, and one clause appears at most once in a test. Rules the write function enforces, because a table cannot: a test's condition is never its own consequence clause, and a chain of exceptions that point at tests never leads back to where it started.

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
| `retired_at` | timestamptz | |

A pair may have many verdicts. A verdict that says "different" is stored like any other.

A view, `clause_pair_state`, gives each pair one state from its live verdicts. If a person has judged the pair, the latest person's verdict decides. Otherwise the state is `equivalent` when every verdict says both directions hold, `different` when none does, and `conflict` when they disagree. The count of contributors is never used.

### `embedding_fingerprint`: which model made the embeddings

One row: the model's name, one fixed sentence and that sentence's embedding. Every write that carries embeddings also carries the model's fresh embedding of the fixed sentence, and the database refuses the write when the fresh embedding's cosine similarity to the stored one is below 0.999. The test is a threshold and not exact equality, because the same model on two machines, or on two builds, gives numbers that differ in the last decimal places. The threshold is the one phase 4 uses to accept the hosted model.

### `conversion_record`: what became of each old row

| Field | Type | Rule |
|---|---|---|
| `principle_id` | uuid | Required |
| `criterion_id` | uuid | Empty for a record about the principle as a whole |
| `test_id`, `clause_id` | uuid | What the old row became |
| `reason` | text | Why it became nothing |

Either a target or a reason is filled. This is the home the mapping asked for. It makes the final check a query, and it keeps a path from a test's clause back to its old `criterion` row. That path is how the six `criterion` fields with no place in the new structure stay reachable. See default 3. The rows are written by `contribute_decomposition`, in the same transaction as the tests they describe, so no separate writer is needed.

### The one change to an existing table

`principle_authority` gains `pinpoint text`, empty on every existing row. One caution from the client code: `merge_authority` deletes a duplicate authority's link whenever the surviving authority already has a link to the same principle, and `unlink_authority` deletes a link outright. A pinpoint on a deleted link goes with it. That is correct for an unlink. For a merge it means the dropped link's pinpoint is lost even when the surviving link has none. The pool holds no pinpoint today, so no existing row is at risk, and `merge_authority` is not changed by this plan. A later change could copy the pinpoint across before the delete.

## Database functions

Each write function replies in one of two shapes: the write was saved, or it was not and here is a question about the item (Commandment 6). The one read function, `clause_search`, returns stored statements with their tests, as `resolve_principle` returns principles with their criteria today. Both readers rest on Exception 4 of the Commandments, and what the plugin shows of a reply is Brahm's call at phase 7.

| Function | What it does |
|---|---|
| `tidy_clause_text(text)` | The tidying rule of `normalize` in `source/probanda/mcp/src/phrases/rank.ts`, written in SQL: Unicode NFC (one fixed way of writing accented letters), trimmed, runs of white space made one space, one trailing period removed, case kept. Declared `immutable`. Postgres's `normalize()` needs the database encoding to be UTF8, which Supabase's is. Postgres's `trim()` removes only the plain space and its `\s` depends on the database's locale, while JavaScript's `trim()` and `\s` cover every Unicode space, so the SQL spells out the set of white-space characters instead of relying on either default. Both versions are tested against one shared list of strings that includes a tab, a line break, a no-break space (U+00A0) and a line separator (U+2028). Where they differ, `rank.ts` is the rule and the SQL is corrected |
| `clause_search(text, embedding, role, limit)` | Read only. First the clause whose `text_key` equals the tidied query, then the nearest clauses by cosine similarity among clauses in the role asked for (`consequence`, `element`, `exception`, `factor`, `rationale` or `any`), 10 unless told otherwise. For each hit: its text and parts, every live test it belongs to with that test's conditions, rationales, stating principles and stale mark, every clause reachable from it through `equivalent` pairs, and separately any pair in `conflict`. No similarity score is returned, because the trial showed the score cannot tell a rewording from a changed meaning |
| `contribute_decomposition(payload, contributor)` | Writes one principle's whole decomposition, with its `conversion_record` rows, or none of it. Reuses a clause whose `text_key` already exists. Reuses a test whose consequence clause and conditions are identical by id, adding only the stated-in link. Refuses an unknown principle, a principle id that `principle_redirects` lists as merged away, a failed or missing fingerprint and any broken rule of `test_clause` |
| `contribute_verdicts(verdicts, contributor)` | Stores verdicts, putting each pair in its one form |
| `retire(kind, id, note, contributor)` | Sets the retired date on a test or a verdict. Deletes nothing |
| `set_clause_embeddings(rows, fingerprint)` | Replaces every clause's embedding and the fingerprint together, in one transaction, for a change of model. It takes all rows in one call and refuses a call that leaves any clause out, because a pool with embeddings from two models under one fingerprint would return wrong neighbours without saying so |

"Is this test already pooled" is answered in two layers. The write function matches by id only, which is exact. The search groups tests by meaning, by following `equivalent` pairs between their consequences and between their conditions. Two tests that mean the same are both kept.

There is no vector index. The search compares the query with every clause, which is exact and fast at a few thousand rows.

## Edge Functions

| Function | Does |
|---|---|
| `commons-search` | Embeds the query, calls `clause_search`, returns its reply |
| `commons-contribute` | Embeds each clause text and the fixed sentence, calls `contribute_decomposition` |
| `commons-reembed` | Embeds every clause and the fixed sentence, calls `set_clause_embeddings` once |

Each creates the model as `new Supabase.ai.Session('gte-small')` and runs it with `mean_pool: true, normalize: true`, the settings Supabase's documentation gives for embeddings, and logs no text it receives. The client sends text and ids and never names a table. Only `commons-search` is ever reached from the plugin. The other two are run from Probanda's development machine by scripts kept under `cloud/legal-commons/`, with the key supplied in an environment variable by the person running them. No script reads the stored credential file.

How a caller is admitted, from Supabase's documentation read 2026-10-13. By default an Edge Function accepts only a caller whose `Authorization` header carries a JWT (a signed token). The pool's `sb_secret_` keys are not JWTs, so each of the three functions is deployed with JWT verification off (`verify_jwt = false` in `supabase/config.toml`, or `--no-verify-jwt`) and checks for itself that the `apikey` header holds a secret key of the project, refusing every other request before it reads the body. The plugin's client already sends the key in the `apikey` header on every call. Inside the function, the project's URL and secret key arrive as environment variables Supabase sets, and the function calls the database function through PostgREST with the `legal_commons` schema named in the request, which works because that schema is already exposed for the existing tools.

`commons-reembed` must finish inside one function run. A few thousand short clauses embed in well under the run limit. If the pool outgrows that, the function is split then, and not before.

## Defaults taken, each of which Brahm can reverse

1. **Reading aids are recorded once per part of a consequence**, not once per clause. Brahm's reading of pilot principle 4 is one compound consequence with two actors, and one actor field cannot hold that. Reversing this folds `clause_part` into three fields on `clause`.
2. **Obiter is recorded on the stated-in link, and left empty by this migration.** Nothing in the pool says which test of a principle an authority's `obiter` flag was about, so copying it would be a guess. `principle_authority.obiter` stays where it is. Neither field can say "this decision supports this one test of that principle". That would need a three-way link of test, principle and authority, and no existing row holds the information to fill one, so it is not built.
3. **The six `criterion` fields with no place get no new field** (`burden_of_proof`, `authority_id`, `in_force_date`, `repeal_date`, `treatment`, `treated_by_authority_id`). They stay on the old row, reachable through `conversion_record`. `repeal_date` is never turned into a retired date, because a retired date marks a mistake and a repeal does not.
4. **Nesting is not given a pointer.** `criterion.determined_by_principle_id` is recorded in `conversion_record` as its old row. The link between an outer test's element and an inner test's consequence comes from the shared clause or a meaning verdict.
5. **A principle that has tests cannot be deleted.** The foreign key from `test_principle` refuses it. The client code deletes rows only from `principle_authority` and `authority`, so no plugin tool deletes a principle today. A merge of two principles, which would write `principle_redirects` and remove a row, exists in no tool and could only be done by hand in the SQL editor. Phase 1's dump confirms that no database function or policy deletes one either.
6. **Testing uses a scratch schema in the live project.** This machine has neither Docker nor the Supabase command-line tool (both checked 2026-10-13), so a local copy of Supabase cannot run here. The scratch schema holds empty copies of the existing tables and the new objects, touches no pool row, and is dropped afterwards. It is still a write to the live project and waits for the phase 2 go-ahead. The alternative is installing Docker Desktop and testing locally. Embeddings in the scratch tests are any 384 numbers, since the Edge Functions are not deployed until phase 4.

## Phases, in order, each with its check

### Phase 1. Learn the live pool's state (gate: Brahm runs the dump)

This is step 4 of the schema plan, unchanged, with three additions to what the dump must show: the distinct values of `criterion.requirement_type`, a row count for every table, and whether any function or policy deletes a `principle` row.

- Check: a written list of every difference from `schema.sql`, `functions.sql` and `rule_periods.sql`. Each difference is then applied to this plan and to the mapping before phase 2 starts.
- The count of principles settles how much there is to decompose. The pool held 16 on 2026-10-12 and July's records describe about 148. The migration does not depend on the answer. Phase 5 does.

### Phase 2. Write and test the migration (gate: Brahm's go-ahead for the scratch schema)

- Files under `cloud/legal-commons/`: `migrations/0001_consequence_structure.sql` (the `vector` extension, the nine tables, the view, the `pinpoint` field, indexes on every foreign key, grants to `service_role`, and `notify pgrst, 'reload schema'`, which tells PostgREST to notice the new objects), `migrations/0001_down.sql` (removes exactly what the first adds), `consequence_functions.sql`, and `functions/` for the three Edge Functions with their `config.toml` entries setting `verify_jwt = false`.
- Tests, each of which can fail: the tidying rule gives the same result in SQL and in `rank.ts` for every string in the shared list. A decomposition with an exception chain that loops is refused. A test whose condition is its own consequence is refused. Contributing the same decomposition twice leaves the row counts unchanged. A rationale for a test its principle does not state is refused. A write with a wrong fingerprint, or with none stored, is refused. A `set_clause_embeddings` call that leaves one clause out is refused. A search reaches a test through two `equivalent` pairs in a row, and does not follow a pair in `conflict`. A person's verdict overrides two model verdicts. Amending a principle's text marks its tests stale. Running the down script leaves the schema as it was before, shown by comparing a dump of the scratch schema taken before the migration with one taken after the down script.
- Check: all of the above pass in the scratch schema, and `python scripts/check_publishable.py --new-since origin/main` reports no new problem.

### Phase 3. Apply to the pool (gate: Brahm's go-ahead)

- Before: run `resolve_principle`, `find_candidates`, `lookup_by_citation`, `treatment_chain` and `rule_periods_find` on fixed inputs and save the replies.
- Apply the migration and the functions file.
- Check: the same five calls return identical replies. The nine tables exist and are empty. The plugin's `browse` tool still answers.

### Phase 4. Deploy the Edge Functions (gate: Brahm's go-ahead)

- Two ways to deploy, neither installed today: the Supabase command-line tool with `supabase functions deploy --use-api`, which bundles on Supabase's servers and needs no Docker, or the dashboard's editor, which keeps no history of earlier versions. The command-line tool is preferred because the deployed code then matches the files under `cloud/legal-commons/functions/`. Which one is used is settled here.
- Store the fingerprint.
- Check: 20 fixed strings embedded on this machine and through the hosted function give a cosine similarity of at least 0.999 for each pair. A request to each function with no `apikey` header, or with the project's publishable key, is refused. The recall check that the schema plan placed here moves to phase 5, because the `clause` table is empty until then and a search over it can find nothing.

### Phase 5. Load the decompositions (gate: Brahm's review of the 16 pilot results)

- Contribute the 16 approved decompositions, each with its `conversion_record` rows, through `commons-contribute`.
- Decompose and contribute any further principles phase 1 found, in batches, by the same two-agent pipeline as the pilot. A person reviews every checker flag and one in ten of the rest.
- Check, as queries: every principle has a test or a `conversion_record` reason for none. Every `criterion` row has a `conversion_record` row. Every test has at least one stated-in link. The `principle_authority` links of principles recorded with a reason for no test are listed for Brahm, since those authorities now reach no test and only he can say whether that is right.
- Check, end to end: each of the 443 consequence rewordings from the trial is sent through `commons-search`, and in at least 95% of them a clause from a test stated by the rewording's own source principle is in the top 10. The source principle of each trial clause is known from the trial's files, and a pooled clause reaches its principle through `test_principle`. This is the first search over real pooled clauses, so a failure here stops phase 6.

### Phase 6. Judge meaning (no further gate)

- Candidate pairs: for each clause, its nearest 10 in the same role, and for each `variant_of` pair of principles, their consequences. Each pair goes once to the `equivalence-checker` agent, and its verdict in both directions is stored through `contribute_verdicts`.
- Check: every candidate pair has a verdict. Every pair in `conflict` is listed for Brahm, since only a person settles one.

### Phase 7. Give the plugin the search (step 8 of the schema plan, unchanged)

One read tool that calls `commons-search`. No schema particulars in any skill or agent file, or under `plugins/` or `public/`. The plugin writes nothing from a reply to disk. Brahm decides here what the tool shows of a reply: a test's clauses with their types and its `equivalent` links are the structure of a rule, and whether sending them to a user's machine goes further than today's criteria do is the question the schema plan's "Not goals" left to this step.

## Undoing it

Phases 3 and 4 are undone by `0001_down.sql` and by deleting the three Edge Functions. Because nothing existing was changed, the pool is then exactly as it was, apart from the `pinpoint` field, which the down script also removes. Phases 5 and 6 only add rows to the new tables, which go with the tables.

## Out of bounds

As the schema plan states them: no write to the live project and no deployed function without Brahm's go-ahead at that phase, no allowlisting of `legal_commons__*`, no reading or printing of the credential, nothing under `cloud/` copied into `plugins/` or `public/`, and no statement of what the law is.
