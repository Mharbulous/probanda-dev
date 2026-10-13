-- =============================================================================
-- Tests of migration 0001 and consequence_functions.sql
-- =============================================================================
-- Not run as it stands. build_scratch_test.mjs puts this between the migration
-- and the down script, renames the schema to a scratch schema throughout, and
-- fills in the tidying cases in test 1.
--
-- Each test records one row through pg_temp.lc_check. A test that raises an
-- error it does not expect stops the whole run, and the transaction around the
-- run then leaves nothing behind.
-- Embeddings are any 384 numbers: no test here needs a real model.
-- =============================================================================

create function pg_temp.lc_check(p_name text, p_pass boolean, p_detail text default null)
returns void language sql as $f$
  insert into lc_test_result (name, pass, detail)
  values (p_name, coalesce(p_pass, false), case when coalesce(p_pass, false) then null else p_detail end);
$f$;

create function pg_temp.lc_vec(p_seed integer)
returns jsonb language sql stable as $f$
  select jsonb_agg(sin(p_seed * 12.9898 + i * 78.233) order by i) from generate_series(1, 384) i;
$f$;

create function pg_temp.lc_clause(p_text text, p_seed integer)
returns jsonb language sql stable as $f$
  select jsonb_build_object('text', p_text, 'embedding', pg_temp.lc_vec(p_seed));
$f$;

create function pg_temp.lc_id(p_text text)
returns uuid language sql stable as $f$
  select c.clause_id from legal_commons.clause c where c.text_key = legal_commons.tidy_clause_text(p_text);
$f$;

create function pg_temp.lc_counts()
returns jsonb language sql stable as $f$
  select jsonb_build_object(
    'clause', (select count(*) from legal_commons.clause),
    'clause_part', (select count(*) from legal_commons.clause_part),
    'test', (select count(*) from legal_commons.test),
    'test_clause', (select count(*) from legal_commons.test_clause),
    'test_principle', (select count(*) from legal_commons.test_principle),
    'test_rationale', (select count(*) from legal_commons.test_rationale),
    'meaning_verdict', (select count(*) from legal_commons.meaning_verdict),
    'embedding_fingerprint', (select count(*) from legal_commons.embedding_fingerprint),
    'conversion_record', (select count(*) from legal_commons.conversion_record));
$f$;

-- Principle one: two tests, the first pointing at the second and listed before
-- it, a consequence with two parts, a rationale and two conversion records.
create function pg_temp.lc_payload_one()
returns jsonb language sql stable as $f$
  select jsonb_build_object(
    'principle_id', '00000000-0000-0000-0000-0000000000a1',
    'fingerprint', pg_temp.lc_vec(1),
    'tests', jsonb_build_array(
      jsonb_build_object(
        'ref', '1.1',
        'consequence', pg_temp.lc_clause('Scratch outcome alpha.', 11)
          || '{"parts":[{"actor":"A party","discretionary":true,"polarity":"affirmative"},{"actor":"The court","discretionary":false,"polarity":"negative"}]}'::jsonb,
        'clauses', jsonb_build_array(
          pg_temp.lc_clause('Scratch condition one', 12) || '{"order":1,"type":"element"}'::jsonb,
          '{"order":2,"type":"exception","points_to_test":"1.2"}'::jsonb)),
      jsonb_build_object(
        'ref', '1.2',
        'consequence', pg_temp.lc_clause('Scratch outcome beta', 13)
          || '{"parts":[{"actor":"A party","discretionary":false,"polarity":"affirmative"}]}'::jsonb,
        'clauses', jsonb_build_array(
          pg_temp.lc_clause('Scratch condition two', 14) || '{"order":1,"type":"factor"}'::jsonb))),
    'rationales', jsonb_build_array(
      pg_temp.lc_clause('Scratch reason', 15) || '{"tests":["1.1"]}'::jsonb),
    'conversion', '[{"criterion_id":"00000000-0000-0000-0000-0000000000c1","test":"1.1","clause_text":"Scratch condition one"},
                    {"reason":"Scratch reason recorded for the whole principle"}]'::jsonb);
$f$;

-- Principle two: five tests with one consequence each, for the search tests.
create function pg_temp.lc_payload_two()
returns jsonb language sql stable as $f$
  select jsonb_build_object(
    'principle_id', '00000000-0000-0000-0000-0000000000a2',
    'fingerprint', pg_temp.lc_vec(1),
    'tests', jsonb_build_array(
      jsonb_build_object('ref', '2.1',
        'consequence', pg_temp.lc_clause('Scratch zeta outcome', 21),
        'clauses', jsonb_build_array(
          pg_temp.lc_clause('Scratch zeta condition', 22) || '{"order":1,"type":"element"}'::jsonb)),
      jsonb_build_object('ref', '2.2', 'consequence', pg_temp.lc_clause('Scratch xi outcome', 23)),
      jsonb_build_object('ref', '2.3', 'consequence', pg_temp.lc_clause('Scratch ypsilon outcome', 24)),
      jsonb_build_object('ref', '2.4', 'consequence', pg_temp.lc_clause('Scratch omega outcome', 25)),
      jsonb_build_object('ref', '2.5', 'consequence', pg_temp.lc_clause('Scratch kappa outcome', 26))));
$f$;

insert into legal_commons.principle (principle_id, text) values
  ('00000000-0000-0000-0000-0000000000a1', 'Scratch principle one.'),
  ('00000000-0000-0000-0000-0000000000a2', 'Scratch principle two.');
insert into legal_commons.criterion (criterion_id, principle_id, description, criterion_order) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1', 'Scratch criterion', 1);
insert into legal_commons.principle_redirects (old_id, canonical_id) values
  ('00000000-0000-0000-0000-0000000000a9', '00000000-0000-0000-0000-0000000000a1');

-- 1. The tidying rule.
do $t$
declare
  v_cases jsonb := /*TIDY_CASES*/;
  v_bad text;
begin
  select string_agg(
    format('%s gave %s, rank.ts gives %s',
      to_jsonb(c.value->>'in'), to_jsonb(legal_commons.tidy_clause_text(c.value->>'in')), c.value->'out'), '; ')
  into v_bad
  from jsonb_array_elements(v_cases) c
  where legal_commons.tidy_clause_text(c.value->>'in') is distinct from c.value->>'out';
  perform pg_temp.lc_check(
    format('tidying rule matches rank.ts on all %s shared strings', jsonb_array_length(v_cases)),
    v_bad is null and jsonb_array_length(v_cases) > 0, v_bad);
end $t$;

-- 2. The fingerprint.
do $t$
declare r jsonb;
begin
  r := legal_commons.contribute_decomposition(pg_temp.lc_payload_one(), 'scratch');
  perform pg_temp.lc_check('a write is refused while no fingerprint is stored',
    r->>'saved' = 'false' and r ? 'question' and pg_temp.lc_counts()->>'clause' = '0', r::text);

  r := legal_commons.set_clause_embeddings(
    jsonb_build_object('model', 'scratch-model', 'sentence', 'Scratch sentence', 'embedding', pg_temp.lc_vec(1)));
  perform pg_temp.lc_check('the first fingerprint is stored while the pool has no clause',
    r->>'saved' = 'true' and pg_temp.lc_counts()->>'embedding_fingerprint' = '1', r::text);

  r := legal_commons.contribute_decomposition(
    pg_temp.lc_payload_one() || jsonb_build_object('fingerprint', pg_temp.lc_vec(2)), 'scratch');
  perform pg_temp.lc_check('a write with a wrong fingerprint is refused',
    r->>'saved' = 'false' and r ? 'question' and pg_temp.lc_counts()->>'clause' = '0', r::text);

  r := legal_commons.contribute_decomposition(pg_temp.lc_payload_one() - 'fingerprint', 'scratch');
  perform pg_temp.lc_check('a write with no fingerprint is refused',
    r->>'saved' = 'false' and r ? 'question' and pg_temp.lc_counts()->>'clause' = '0', r::text);
end $t$;

-- 3. Refusals that leave nothing behind.
do $t$
declare
  r jsonb;
  v_before jsonb := pg_temp.lc_counts();
begin
  r := legal_commons.contribute_decomposition(jsonb_build_object(
    'principle_id', '00000000-0000-0000-0000-0000000000a1',
    'fingerprint', pg_temp.lc_vec(1),
    'tests', jsonb_build_array(
      jsonb_build_object('ref', 'x', 'consequence', pg_temp.lc_clause('Scratch loop outcome x', 31),
        'clauses', '[{"order":1,"type":"exception","points_to_test":"y"}]'::jsonb),
      jsonb_build_object('ref', 'y', 'consequence', pg_temp.lc_clause('Scratch loop outcome y', 32),
        'clauses', '[{"order":1,"type":"exception","points_to_test":"x"}]'::jsonb))), 'scratch');
  perform pg_temp.lc_check('an exception chain that loops is refused, and nothing is saved',
    r->>'saved' = 'false' and r ? 'question' and pg_temp.lc_counts() = v_before, r::text);

  r := legal_commons.contribute_decomposition(jsonb_build_object(
    'principle_id', '00000000-0000-0000-0000-0000000000a1',
    'fingerprint', pg_temp.lc_vec(1),
    'tests', jsonb_build_array(
      jsonb_build_object('ref', 'x', 'consequence', pg_temp.lc_clause('Scratch self outcome', 33),
        'clauses', jsonb_build_array(
          pg_temp.lc_clause('  Scratch   self outcome. ', 34) || '{"order":1,"type":"element"}'::jsonb)))), 'scratch');
  perform pg_temp.lc_check('a test whose condition is its own consequence is refused, and nothing is saved',
    r->>'saved' = 'false' and r ? 'question' and pg_temp.lc_counts() = v_before, r::text);

  r := legal_commons.contribute_decomposition(
    pg_temp.lc_payload_one() || '{"principle_id":"00000000-0000-0000-0000-0000000000ff"}'::jsonb, 'scratch');
  perform pg_temp.lc_check('an unknown principle is refused',
    r->>'saved' = 'false' and r ? 'question' and pg_temp.lc_counts() = v_before, r::text);

  r := legal_commons.contribute_decomposition(
    pg_temp.lc_payload_one() || '{"principle_id":"00000000-0000-0000-0000-0000000000a9"}'::jsonb, 'scratch');
  perform pg_temp.lc_check('a principle id that was merged away is refused',
    r->>'saved' = 'false' and r ? 'question' and pg_temp.lc_counts() = v_before, r::text);

  r := legal_commons.contribute_decomposition(
    pg_temp.lc_payload_one() || '{"principle_id":"abc"}'::jsonb, 'scratch');
  perform pg_temp.lc_check('a principle id that is not an id gets a question, not a database error',
    r->>'saved' = 'false' and r ? 'question' and pg_temp.lc_counts() = v_before, r::text);

  r := legal_commons.contribute_decomposition(
    pg_temp.lc_payload_one() || '{"conversion":[{"criterion_id":"abc","reason":"Scratch"}]}'::jsonb, 'scratch');
  perform pg_temp.lc_check('a malformed id deep in a decomposition gets a question, and nothing is saved',
    r->>'saved' = 'false' and r ? 'question' and pg_temp.lc_counts() = v_before, r::text);
end $t$;

-- 4. A good decomposition, and the same one again.
do $t$
declare
  r jsonb;
  v_after jsonb;
  v_expected jsonb := '{"clause":5,"clause_part":3,"test":2,"test_clause":3,"test_principle":2,"test_rationale":1,
                        "meaning_verdict":0,"embedding_fingerprint":1,"conversion_record":2}'::jsonb;
begin
  r := legal_commons.contribute_decomposition(pg_temp.lc_payload_one(), 'scratch');
  v_after := pg_temp.lc_counts();
  perform pg_temp.lc_check('a whole decomposition is saved with the expected rows',
    r->>'saved' = 'true' and r->>'tests_made' = '2' and v_after = v_expected, r::text || ' ' || v_after::text);

  perform pg_temp.lc_check('an exception is stored pointing at the other test',
    exists (
      select 1 from legal_commons.test_clause tc
      where tc.test_id = (r->'tests'->>'1.1')::uuid
        and tc.clause_type = 'exception'
        and tc.points_to_test_id = (r->'tests'->>'1.2')::uuid
        and tc.clause_id is null), r::text);

  r := legal_commons.contribute_decomposition(pg_temp.lc_payload_one(), 'scratch');
  perform pg_temp.lc_check('contributing the same decomposition twice leaves the row counts unchanged',
    r->>'saved' = 'true' and r->>'tests_made' = '0' and pg_temp.lc_counts() = v_after,
    r::text || ' ' || pg_temp.lc_counts()::text);
end $t$;

-- 5. A rationale for a test its principle does not state.
do $t$
begin
  insert into legal_commons.test_rationale (test_id, clause_id, principle_id)
  select tp.test_id, pg_temp.lc_id('Scratch reason'), '00000000-0000-0000-0000-0000000000a2'
  from legal_commons.test_principle tp
  where tp.principle_id = '00000000-0000-0000-0000-0000000000a1'
  limit 1;
  perform pg_temp.lc_check('a rationale for a test its principle does not state is refused', false, 'the row was accepted');
exception when foreign_key_violation then
  perform pg_temp.lc_check('a rationale for a test its principle does not state is refused', true);
end $t$;

-- 6. Replacing the embeddings.
do $t$
declare
  r jsonb;
  v_all jsonb;
  v_first jsonb;
  v_new jsonb := jsonb_build_object('model', 'scratch-model-2', 'sentence', 'Scratch sentence', 'embedding', pg_temp.lc_vec(1));
  v_sum_before text;
  v_sum_after text;
begin
  select jsonb_agg(jsonb_build_object('clause_id', c.clause_id, 'embedding', pg_temp.lc_vec(40)) order by c.clause_id),
         md5(string_agg(c.embedding::text, '|' order by c.clause_id))
  into v_all, v_sum_before
  from legal_commons.clause c;
  v_first := jsonb_build_array(v_all->0);

  r := legal_commons.stage_clause_embeddings(
    jsonb_build_array(v_all->0 || '{"clause_id":"abc"}'::jsonb), pg_temp.lc_vec(1));
  perform pg_temp.lc_check('a staged batch with a malformed id gets a question, not a database error',
    r->>'saved' = 'false' and r ? 'question'
      and (select count(*) from legal_commons.clause_embedding_staging) = 0, r::text);

  -- The first batch: every clause but one.
  r := legal_commons.stage_clause_embeddings(v_all - 0, pg_temp.lc_vec(1));
  select md5(string_agg(c.embedding::text, '|' order by c.clause_id)) into v_sum_after from legal_commons.clause c;
  perform pg_temp.lc_check('staging a batch is saved and changes no embedding the search reads',
    r->>'saved' = 'true' and r->>'staged' = '4' and v_sum_after = v_sum_before, r::text);

  r := legal_commons.set_clause_embeddings(v_new);
  select md5(string_agg(c.embedding::text, '|' order by c.clause_id)) into v_sum_after from legal_commons.clause c;
  perform pg_temp.lc_check('replacing embeddings with one clause left out is refused, and nothing changes',
    r->>'saved' = 'false' and r ? 'question' and v_sum_after = v_sum_before
      and (select f.model from legal_commons.embedding_fingerprint f) = 'scratch-model', r::text);

  -- The second batch, as if made by another model.
  r := legal_commons.stage_clause_embeddings(v_first, pg_temp.lc_vec(2));
  r := legal_commons.set_clause_embeddings(v_new);
  select md5(string_agg(c.embedding::text, '|' order by c.clause_id)) into v_sum_after from legal_commons.clause c;
  perform pg_temp.lc_check('replacing embeddings staged under two fingerprints is refused, and nothing changes',
    r->>'saved' = 'false' and r ? 'question' and v_sum_after = v_sum_before
      and (select f.model from legal_commons.embedding_fingerprint f) = 'scratch-model', r::text);

  -- The second batch again, by the right model: it replaces what was staged.
  r := legal_commons.stage_clause_embeddings(v_first, pg_temp.lc_vec(1));
  r := legal_commons.set_clause_embeddings(v_new);
  select md5(string_agg(c.embedding::text, '|' order by c.clause_id)) into v_sum_after from legal_commons.clause c;
  perform pg_temp.lc_check('replacing every embedding from two staged batches is saved, with the fingerprint',
    r->>'saved' = 'true' and r->>'clauses' = '5' and v_sum_after <> v_sum_before
      and (select f.model from legal_commons.embedding_fingerprint f) = 'scratch-model-2'
      and (select count(*) from legal_commons.clause_embedding_staging) = 0, r::text);
end $t$;

-- 7. The search and meaning verdicts. xi = ypsilon = zeta by two model verdicts
-- in a row. xi and omega are in conflict, and omega = kappa, so kappa can be
-- reached only by following the conflict.
do $t$
declare
  r jsonb;
  v_model jsonb := '{"judge_kind":"model","judge_model":"scratch-judge","judge_prompt_version":"1"}'::jsonb;
  v_q extensions.vector := pg_temp.lc_vec(23)::text::extensions.vector;
begin
  r := legal_commons.contribute_decomposition(pg_temp.lc_payload_two(), 'scratch');
  perform pg_temp.lc_check('a test with no condition besides its consequence is saved',
    r->>'saved' = 'true' and r->>'tests_made' = '5', r::text);

  r := legal_commons.contribute_verdicts(jsonb_build_array(
    v_model || jsonb_build_object('clause_a', pg_temp.lc_id('Scratch xi outcome'), 'clause_b', pg_temp.lc_id('Scratch ypsilon outcome'), 'a_implies_b', true, 'b_implies_a', true),
    v_model || jsonb_build_object('clause_a', pg_temp.lc_id('Scratch ypsilon outcome'), 'clause_b', pg_temp.lc_id('Scratch zeta outcome'), 'a_implies_b', true, 'b_implies_a', true),
    v_model || jsonb_build_object('clause_a', pg_temp.lc_id('Scratch xi outcome'), 'clause_b', pg_temp.lc_id('Scratch omega outcome'), 'a_implies_b', true, 'b_implies_a', true),
    v_model || jsonb_build_object('clause_a', pg_temp.lc_id('Scratch xi outcome'), 'clause_b', pg_temp.lc_id('Scratch omega outcome'), 'a_implies_b', false, 'b_implies_a', false),
    v_model || jsonb_build_object('clause_a', pg_temp.lc_id('Scratch omega outcome'), 'clause_b', pg_temp.lc_id('Scratch kappa outcome'), 'a_implies_b', true, 'b_implies_a', true)
  ), 'scratch');
  perform pg_temp.lc_check('verdicts are saved', r->>'saved' = 'true' and r->>'verdicts' = '5', r::text);

  r := legal_commons.clause_search(' Scratch  xi outcome. ', v_q, 'consequence', 3);
  perform pg_temp.lc_check('the search finds the clause whose tidied text equals the tidied query',
    r->'exact'->>'text' = 'Scratch xi outcome' and jsonb_array_length(r->'nearest') = 3, r::text);
  perform pg_temp.lc_check('the search reaches a test through two equivalent pairs in a row',
    jsonb_path_exists(r, '$.exact.equivalent[*] ? (@.text == "Scratch zeta outcome").tests[*].conditions[*] ? (@.text == "Scratch zeta condition")'),
    (r->'exact'->'equivalent')::text);
  perform pg_temp.lc_check('the search does not follow a pair in conflict, and lists it apart',
    not jsonb_path_exists(r, '$.exact.equivalent[*] ? (@.text == "Scratch omega outcome" || @.text == "Scratch kappa outcome")')
      and jsonb_path_exists(r, '$.exact.conflicts[*] ? (@.text == "Scratch omega outcome")')
      and jsonb_array_length(r->'exact'->'conflicts') = 1,
    (r->'exact')::text);
  perform pg_temp.lc_check('the search returns no similarity score',
    not jsonb_path_exists(r, '$.** ? (exists(@.score) || exists(@.similarity) || exists(@.distance))'), r::text);

  r := legal_commons.clause_search('Scratch reason', v_q, 'rationale', 10);
  perform pg_temp.lc_check('a role limits the nearest clauses to that role',
    r->'exact'->>'text' = 'Scratch reason' and jsonb_array_length(r->'nearest') = 0, r::text);

  r := legal_commons.clause_search('Scratch reason', v_q, 'scratch-role', 10);
  perform pg_temp.lc_check('a search for an unknown role gets a question, not a database error',
    r ? 'question' and jsonb_array_length(r->'nearest') = 0, r::text);
end $t$;

-- 8. A person's verdict overrides two model verdicts, and a pair has one form.
do $t$
declare
  r jsonb;
  v_one uuid := pg_temp.lc_id('Scratch condition one');
  v_two uuid := pg_temp.lc_id('Scratch condition two');
  v_small uuid := least(v_one, v_two);
  v_large uuid := greatest(v_one, v_two);
  v_state text;
  v_person boolean;
begin
  r := legal_commons.contribute_verdicts(jsonb_build_array(
    jsonb_build_object('clause_a', v_small, 'clause_b', v_large, 'a_implies_b', true, 'b_implies_a', true,
      'judge_kind', 'model', 'judge_model', 'scratch-judge', 'judge_prompt_version', '1'),
    jsonb_build_object('clause_a', v_small, 'clause_b', v_large, 'a_implies_b', true, 'b_implies_a', true,
      'judge_kind', 'model', 'judge_model', 'scratch-judge-2', 'judge_prompt_version', '1')), 'scratch');
  select s.state into v_state from legal_commons.clause_pair_state s where s.clause_a = v_small and s.clause_b = v_large;
  perform pg_temp.lc_check('two agreeing model verdicts make a pair equivalent', v_state = 'equivalent', v_state);

  -- Sent with the larger id first: large implies small, small does not imply large.
  r := legal_commons.contribute_verdicts(jsonb_build_array(
    jsonb_build_object('clause_a', v_large, 'clause_b', v_small, 'a_implies_b', true, 'b_implies_a', false,
      'judge_kind', 'person')), 'scratch');
  perform pg_temp.lc_check('a verdict sent with the larger id first is stored in the pair''s one form',
    r->>'saved' = 'true' and exists (
      select 1 from legal_commons.meaning_verdict v
      where v.judge_kind = 'person' and v.clause_a = v_small and v.clause_b = v_large
        and not v.a_implies_b and v.b_implies_a), r::text);

  select s.state, s.decided_by_person into v_state, v_person
  from legal_commons.clause_pair_state s where s.clause_a = v_small and s.clause_b = v_large;
  perform pg_temp.lc_check('a person''s verdict overrides two model verdicts',
    v_state = 'different' and v_person, v_state);

  r := legal_commons.contribute_verdicts(jsonb_build_array(
    jsonb_build_object('clause_a', v_small, 'clause_b', v_large, 'a_implies_b', true, 'b_implies_a', true,
      'judge_kind', 'model')), 'scratch');
  perform pg_temp.lc_check('a model verdict that names no model is refused',
    r->>'saved' = 'false' and r ? 'question', r::text);

  r := legal_commons.contribute_verdicts(jsonb_build_array(
    jsonb_build_object('clause_a', 'abc', 'clause_b', v_large, 'a_implies_b', 'perhaps', 'b_implies_a', true,
      'judge_kind', 'person')), 'scratch');
  perform pg_temp.lc_check('a verdict with a malformed id gets a question, not a database error',
    r->>'saved' = 'false' and r ? 'question', r::text);
end $t$;

-- 9. Amending a principle's text marks its tests stale.
do $t$
declare
  r jsonb;
  v_q extensions.vector := pg_temp.lc_vec(11)::text::extensions.vector;
begin
  r := legal_commons.clause_search('Scratch outcome alpha', v_q, 'any', 1);
  perform pg_temp.lc_check('a test is not stale while its principle''s text is unchanged',
    jsonb_array_length(r->'exact'->'tests') = 1
      and not jsonb_path_exists(r, '$.exact.tests[*] ? (@.stale == true)'), (r->'exact')::text);

  update legal_commons.principle set text = 'Scratch principle one, amended.'
  where principle_id = '00000000-0000-0000-0000-0000000000a1';

  r := legal_commons.clause_search('Scratch outcome alpha', v_q, 'any', 1);
  perform pg_temp.lc_check('amending a principle''s text marks its tests stale',
    jsonb_path_exists(r, '$.exact.tests[*] ? (@.stale == true)')
      and jsonb_path_exists(r, '$.exact.tests[*].stated_in[*] ? (@.stale == true)'), (r->'exact')::text);
end $t$;

-- 10. Retiring.
do $t$
declare
  r jsonb;
  v_test uuid;
  v_q extensions.vector := pg_temp.lc_vec(25)::text::extensions.vector;
begin
  select t.test_id into v_test from legal_commons.test t
  where t.consequence_clause_id = pg_temp.lc_id('Scratch omega outcome');

  r := legal_commons.retire('test', v_test, 'Scratch mistake', 'scratch');
  perform pg_temp.lc_check('retiring a test sets its retired date and deletes nothing',
    r->>'saved' = 'true' and exists (
      select 1 from legal_commons.test t
      where t.test_id = v_test and t.retired_at is not null and t.retired_note = 'Scratch mistake'), r::text);

  r := legal_commons.retire('test', v_test, 'Scratch mistake', 'scratch');
  perform pg_temp.lc_check('retiring a test twice is refused', r->>'saved' = 'false' and r ? 'question', r::text);

  r := legal_commons.clause_search('Scratch omega outcome', v_q, 'any', 1);
  perform pg_temp.lc_check('a retired test is not shown by the search',
    jsonb_array_length(r->'exact'->'tests') = 0, (r->'exact')::text);
end $t$;

drop function pg_temp.lc_payload_two();
drop function pg_temp.lc_payload_one();
drop function pg_temp.lc_counts();
drop function pg_temp.lc_id(text);
drop function pg_temp.lc_clause(text, integer);
drop function pg_temp.lc_vec(integer);
drop function pg_temp.lc_check(text, boolean, text);
