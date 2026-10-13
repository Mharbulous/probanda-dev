-- =============================================================================
-- Functions of the consequence-first structure (2026-10-13)
-- =============================================================================
-- Plan: restructuring-plan.md. Apply AFTER migrations/0001_consequence_structure.sql,
-- in one paste in the SQL editor. Idempotent: safe to re-run.
-- Undone by migrations/0001_down.sql.
--
-- Six functions here; the seventh, tidy_clause_text, is in the migration because
-- the `clause` table is built on it.
--
-- Replies. clause_search is the one reader. Each of the five writers replies in
-- one of two shapes and no other:
--   {"saved": true, ...}                    the write was saved
--   {"saved": false, "question": "..."}     nothing was saved; a question about
--                                           the item that was sent
-- A refused write leaves no row behind: the writers that do more than one write
-- run them inside a block that is rolled back whole when a question is raised
-- (SQLSTATE LC001, used for nothing else). A value inside the JSON that is not
-- in its proper form (an id that is not a uuid, a number that is not a number)
-- raises a Postgres error of class 22 (`data_exception`), and the same block
-- turns that into a question too. An argument that is itself typed (retire's
-- id, clause_search's embedding) is converted by PostgREST before the function
-- starts, so a malformed one gets PostgREST's own error and never reaches here.
--
-- Embeddings arrive as JSON arrays of 384 numbers, made by the Edge Functions.
-- No function here runs a model.
-- =============================================================================

set search_path = legal_commons, extensions, public;

-- -----------------------------------------------------------------------------
-- clause_search: read only. First the clause whose text_key equals the tidied
-- query, then the nearest clauses by cosine similarity among clauses in the role
-- asked for. For each hit: its text and parts, every live test it belongs to
-- (with that test's conditions, rationales, stating principles and stale mark),
-- every clause reachable from it through `equivalent` pairs with those clauses'
-- tests, and separately each clause it is in `conflict` with. A pair in
-- `conflict` is never followed. No similarity score is returned.
-- No vector index: every clause in the role is compared, which is exact.
-- -----------------------------------------------------------------------------
create or replace function legal_commons.clause_search(
  p_text text,
  p_embedding extensions.vector,
  p_role text default 'any',
  p_limit integer default 10
)
returns jsonb
language plpgsql
stable
set search_path = legal_commons, extensions
as $$
declare
  v_role text := coalesce(p_role, 'any');
begin
  if v_role not in ('any', 'consequence', 'element', 'exception', 'factor', 'rationale') then
    return jsonb_build_object('exact', null, 'nearest', '[]'::jsonb, 'question',
      'Which kind of statement is being looked for: a consequence, an element, an exception, a factor, a rationale, or any?');
  end if;

  return (
    with recursive
    exact as (
      select c.clause_id
      from legal_commons.clause c
      where c.text_key = legal_commons.tidy_clause_text(p_text)
    ),
    in_role as (
      select c.clause_id, c.embedding
      from legal_commons.clause c
      where case v_role
        when 'any' then true
        when 'consequence' then exists (
          select 1 from legal_commons.test t
          where t.consequence_clause_id = c.clause_id and t.retired_at is null)
        when 'rationale' then exists (
          select 1 from legal_commons.test_rationale tr
          join legal_commons.test t on t.test_id = tr.test_id
          where tr.clause_id = c.clause_id and t.retired_at is null)
        else exists (
          select 1 from legal_commons.test_clause tc
          join legal_commons.test t on t.test_id = tc.test_id
          where tc.clause_id = c.clause_id and tc.clause_type = v_role and t.retired_at is null)
      end
    ),
    nearest as (
      select x.clause_id, x.rank
      from (
        select r.clause_id,
               row_number() over (order by r.embedding <=> p_embedding, r.clause_id) as rank
        from in_role r
        where not exists (select 1 from exact e where e.clause_id = r.clause_id)
      ) x
      where x.rank <= greatest(coalesce(p_limit, 10), 1)
    ),
    hits as (
      select e.clause_id, 0::bigint as rank, true as is_exact from exact e
      union all
      select n.clause_id, n.rank, false from nearest n
    ),
    -- Each hit with every clause reachable from it through `equivalent` pairs.
    reach(hit_id, clause_id) as (
      select h.clause_id, h.clause_id from hits h
      union
      select r.hit_id, case when s.clause_a = r.clause_id then s.clause_b else s.clause_a end
      from reach r
      join legal_commons.clause_pair_state s
        on s.state = 'equivalent' and r.clause_id in (s.clause_a, s.clause_b)
    ),
    -- Every use of a clause by a live test: as consequence, condition or rationale.
    clause_tests as (
      select t.consequence_clause_id as clause_id, t.test_id
      from legal_commons.test t where t.retired_at is null
      union
      select tc.clause_id, tc.test_id
      from legal_commons.test_clause tc
      join legal_commons.test t on t.test_id = tc.test_id
      where tc.clause_id is not null and t.retired_at is null
      union
      select tr.clause_id, tr.test_id
      from legal_commons.test_rationale tr
      join legal_commons.test t on t.test_id = tr.test_id
      where t.retired_at is null
    ),
    test_json as (
      select t.test_id, jsonb_build_object(
        'test_id', t.test_id,
        'consequence', jsonb_build_object(
          'clause_id', cc.clause_id,
          'text', cc.text,
          'parts', coalesce((
            select jsonb_agg(jsonb_build_object(
              'actor', p.actor, 'discretionary', p.discretionary, 'polarity', p.polarity
            ) order by p.part_order)
            from legal_commons.clause_part p where p.clause_id = cc.clause_id
          ), '[]'::jsonb)),
        'conditions', coalesce((
          select jsonb_agg(jsonb_build_object(
            'order', tc.clause_order,
            'type', tc.clause_type,
            'clause_id', tc.clause_id,
            'text', c2.text,
            'points_to_test_id', tc.points_to_test_id
          ) order by tc.clause_order)
          from legal_commons.test_clause tc
          left join legal_commons.clause c2 on c2.clause_id = tc.clause_id
          where tc.test_id = t.test_id
        ), '[]'::jsonb),
        'rationales', coalesce((
          select jsonb_agg(jsonb_build_object(
            'clause_id', tr.clause_id, 'text', c3.text, 'principle_id', tr.principle_id
          ) order by c3.text, tr.principle_id)
          from legal_commons.test_rationale tr
          join legal_commons.clause c3 on c3.clause_id = tr.clause_id
          where tr.test_id = t.test_id
        ), '[]'::jsonb),
        'stated_in', coalesce((
          select jsonb_agg(jsonb_build_object(
            'principle_id', tp.principle_id,
            'obiter', tp.obiter,
            'stale', tp.principle_text_md5 is distinct from md5(pr.text)
          ) order by tp.principle_id)
          from legal_commons.test_principle tp
          join legal_commons.principle pr on pr.principle_id = tp.principle_id
          where tp.test_id = t.test_id
        ), '[]'::jsonb),
        'stale', exists (
          select 1
          from legal_commons.test_principle tp
          join legal_commons.principle pr on pr.principle_id = tp.principle_id
          where tp.test_id = t.test_id and tp.principle_text_md5 is distinct from md5(pr.text))
      ) as j
      from legal_commons.test t
      join legal_commons.clause cc on cc.clause_id = t.consequence_clause_id
      where t.retired_at is null
        and t.test_id in (
          select ct.test_id from clause_tests ct
          where ct.clause_id in (select r.clause_id from reach r))
    ),
    clause_json as (
      select c.clause_id, jsonb_build_object(
        'clause_id', c.clause_id,
        'text', c.text,
        'parts', coalesce((
          select jsonb_agg(jsonb_build_object(
            'actor', p.actor, 'discretionary', p.discretionary, 'polarity', p.polarity
          ) order by p.part_order)
          from legal_commons.clause_part p where p.clause_id = c.clause_id
        ), '[]'::jsonb),
        'tests', coalesce((
          select jsonb_agg(tj.j order by tj.test_id)
          from clause_tests ct
          join test_json tj on tj.test_id = ct.test_id
          where ct.clause_id = c.clause_id
        ), '[]'::jsonb)
      ) as j
      from legal_commons.clause c
      where c.clause_id in (select r.clause_id from reach r)
    ),
    hit_json as (
      select h.rank, h.is_exact, cj.j || jsonb_build_object(
        'equivalent', coalesce((
          select jsonb_agg(cj2.j order by cj2.clause_id)
          from reach r
          join clause_json cj2 on cj2.clause_id = r.clause_id
          where r.hit_id = h.clause_id and r.clause_id <> h.clause_id
        ), '[]'::jsonb),
        'conflicts', coalesce((
          select jsonb_agg(jsonb_build_object('clause_id', o.clause_id, 'text', o.text) order by o.clause_id)
          from legal_commons.clause_pair_state s
          join legal_commons.clause o
            on o.clause_id = case when s.clause_a = h.clause_id then s.clause_b else s.clause_a end
          where s.state = 'conflict' and h.clause_id in (s.clause_a, s.clause_b)
        ), '[]'::jsonb)
      ) as j
      from hits h
      join clause_json cj on cj.clause_id = h.clause_id
    )
    select jsonb_build_object(
      'exact', (select hj.j from hit_json hj where hj.is_exact),
      'nearest', coalesce((
        select jsonb_agg(hj.j order by hj.rank) from hit_json hj where not hj.is_exact
      ), '[]'::jsonb)
    )
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- contribute_decomposition: one principle's whole decomposition, with its
-- conversion_record rows, or none of it. Payload:
--   { "principle_id": uuid,
--     "fingerprint": [384 numbers],          -- fresh embedding of the fixed sentence
--     "tests": [ { "ref": "3.1",             -- a label used only inside this payload
--                  "consequence": { "text", "embedding", "parts": [ { "actor", "discretionary", "polarity" } ] },
--                  "clauses": [ { "order", "type", "text", "embedding" }
--                             | { "order", "type": "exception", "points_to_test": "3.2" } ] } ],
--     "rationales": [ { "text", "embedding", "tests": ["3.1"] } ],
--     "conversion": [ { "criterion_id" | null, "test": ref | null, "clause_text" | null, "reason" | null } ] }
--
-- A clause whose text_key already exists is reused. A live test whose
-- consequence clause and set of conditions are identical by id is reused, and
-- gains only the stated-in link. A test is made only after every test it points
-- at, so a chain of pointers that loops can never be stored.
-- -----------------------------------------------------------------------------
create or replace function legal_commons.contribute_decomposition(p_payload jsonb, p_contributor text)
returns jsonb
language plpgsql
set search_path = legal_commons, extensions
as $$
declare
  v_principle_id uuid;
  v_principle_text text;
  v_md5 text;
  v_stored extensions.vector;
  v_tests jsonb := coalesce(p_payload->'tests', '[]'::jsonb);
  v_texts jsonb;
  v_test jsonb;
  v_ids jsonb := '{}'::jsonb;          -- the payload's ref -> test_id
  v_made integer := 0;
  v_progress boolean;
  v_cid uuid;
  v_conds jsonb;
  v_key jsonb;
  v_test_id uuid;
  v_rat jsonb;
  v_conv jsonb;
  v_crit uuid;
  v_conv_test uuid;
  v_conv_clause uuid;
  v_reason text;
begin
  begin
    -- The principle.
    v_principle_id := (p_payload->>'principle_id')::uuid;
    if v_principle_id is null then
      raise sqlstate 'LC001' using message = 'Which principle is this a decomposition of?';
    end if;
    if exists (select 1 from legal_commons.principle_redirects r where r.old_id = v_principle_id) then
      raise sqlstate 'LC001' using message = 'Has this principle been merged into another one since it was decomposed?';
    end if;
    select p.text into v_principle_text from legal_commons.principle p where p.principle_id = v_principle_id;
    if not found then
      raise sqlstate 'LC001' using message = 'Is this principle in the pool?';
    end if;
    v_md5 := md5(v_principle_text);

    -- The fingerprint.
    select f.embedding into v_stored from legal_commons.embedding_fingerprint f;
    if not found then
      raise sqlstate 'LC001' using message = 'Has the fingerprint of the embedding model been stored in the pool yet?';
    end if;
    if (case when jsonb_typeof(p_payload->'fingerprint') = 'array'
             then jsonb_array_length(p_payload->'fingerprint') else 0 end) <> 384 then
      raise sqlstate 'LC001' using message = 'Did this contribution come with the embedding model''s fresh embedding of the fixed sentence?';
    end if;
    if 1 - (v_stored <=> (p_payload->'fingerprint')::text::extensions.vector) < 0.999 then
      raise sqlstate 'LC001' using message = 'Were these embeddings made by the same model as the embeddings already in the pool?';
    end if;

    -- Every statement the payload carries: consequences, conditions, rationales.
    select coalesce(jsonb_agg(x.item), '[]'::jsonb) into v_texts
    from (
      select t.value->'consequence' as item
      from jsonb_array_elements(v_tests) t
      union all
      select c.value
      from jsonb_array_elements(v_tests) t,
           jsonb_array_elements(coalesce(t.value->'clauses', '[]'::jsonb)) c
      where c.value->>'text' is not null
      union all
      select r.value
      from jsonb_array_elements(coalesce(p_payload->'rationales', '[]'::jsonb)) r
    ) x;

    if exists (
      select 1 from jsonb_array_elements(v_texts) x
      where x.value->>'text' is null or legal_commons.tidy_clause_text(x.value->>'text') = ''
    ) then
      raise sqlstate 'LC001' using message = 'Does every consequence, condition and rationale in this decomposition have wording?';
    end if;
    if exists (
      select 1 from jsonb_array_elements(v_texts) x
      where (case when jsonb_typeof(x.value->'embedding') = 'array'
                  then jsonb_array_length(x.value->'embedding') else 0 end) <> 384
    ) then
      raise sqlstate 'LC001' using message = 'Does every statement in this decomposition come with its embedding?';
    end if;
    if exists (
      select 1
      from jsonb_array_elements(v_tests) t,
           jsonb_array_elements(coalesce(t.value->'consequence'->'parts', '[]'::jsonb)) p
      where jsonb_typeof(p.value->'discretionary') is distinct from 'boolean'
         or p.value->>'polarity' is null
         or p.value->>'polarity' not in ('affirmative', 'negative')
    ) then
      raise sqlstate 'LC001' using message = 'Does each part of each consequence say whether it is discretionary and whether it is affirmative or negative?';
    end if;

    -- The labels.
    if exists (select 1 from jsonb_array_elements(v_tests) t where coalesce(t.value->>'ref', '') = '')
       or (select count(distinct t.value->>'ref') from jsonb_array_elements(v_tests) t) <> jsonb_array_length(v_tests) then
      raise sqlstate 'LC001' using message = 'Does each test in this decomposition have its own label?';
    end if;
    if exists (
      select 1
      from jsonb_array_elements(v_tests) t,
           jsonb_array_elements(coalesce(t.value->'clauses', '[]'::jsonb)) c
      where c.value->>'points_to_test' is not null
        and not exists (
          select 1 from jsonb_array_elements(v_tests) t2
          where t2.value->>'ref' = c.value->>'points_to_test')
    ) then
      raise sqlstate 'LC001' using message = 'Does every exception that points at a test point at a test in this decomposition?';
    end if;

    -- The clauses. One whose tidied text is already pooled is reused.
    insert into legal_commons.clause (text, embedding)
    select distinct on (legal_commons.tidy_clause_text(x.value->>'text'))
           x.value->>'text', (x.value->'embedding')::text::extensions.vector
    from jsonb_array_elements(v_texts) x
    order by legal_commons.tidy_clause_text(x.value->>'text')
    on conflict (text_key) do nothing;

    -- The tests, each after every test it points at.
    while (select count(*) from jsonb_object_keys(v_ids)) < jsonb_array_length(v_tests) loop
      v_progress := false;
      for v_test in
        select t.value
        from jsonb_array_elements(v_tests) t
        where not v_ids ? (t.value->>'ref')
          and not exists (
            select 1 from jsonb_array_elements(coalesce(t.value->'clauses', '[]'::jsonb)) c
            where c.value->>'points_to_test' is not null
              and not v_ids ? (c.value->>'points_to_test'))
      loop
        select c.clause_id into v_cid
        from legal_commons.clause c
        where c.text_key = legal_commons.tidy_clause_text(v_test->'consequence'->>'text');

        if not exists (select 1 from legal_commons.clause_part p where p.clause_id = v_cid) then
          insert into legal_commons.clause_part (clause_id, part_order, actor, discretionary, polarity)
          select v_cid, p.ord, p.value->>'actor', (p.value->>'discretionary')::boolean, p.value->>'polarity'
          from jsonb_array_elements(coalesce(v_test->'consequence'->'parts', '[]'::jsonb))
               with ordinality as p(value, ord);
        end if;

        select coalesce(jsonb_agg(jsonb_build_object(
                 'ord', coalesce((c.value->>'order')::integer, c.ord::integer),
                 'type', c.value->>'type',
                 'clause_id', k.clause_id,
                 'points_to', v_ids->>(c.value->>'points_to_test'))), '[]'::jsonb)
        into v_conds
        from jsonb_array_elements(coalesce(v_test->'clauses', '[]'::jsonb)) with ordinality as c(value, ord)
        left join legal_commons.clause k
          on c.value->>'text' is not null
         and k.text_key = legal_commons.tidy_clause_text(c.value->>'text');

        if exists (
          select 1 from jsonb_to_recordset(v_conds) as x(ord integer, type text, clause_id uuid, points_to uuid)
          where x.type is null or x.type not in ('element', 'exception', 'factor')
        ) then
          raise sqlstate 'LC001' using message = 'Is each condition of each test an element, an exception or a factor?';
        end if;
        if exists (
          select 1 from jsonb_to_recordset(v_conds) as x(ord integer, type text, clause_id uuid, points_to uuid)
          where num_nonnulls(x.clause_id, x.points_to) <> 1
        ) then
          raise sqlstate 'LC001' using message = 'Does each condition hold either wording or a pointer to another test, and not both?';
        end if;
        if exists (
          select 1 from jsonb_to_recordset(v_conds) as x(ord integer, type text, clause_id uuid, points_to uuid)
          where x.points_to is not null and x.type <> 'exception'
        ) then
          raise sqlstate 'LC001' using message = 'Is every condition that points at another test an exception?';
        end if;
        if exists (
          select 1 from jsonb_to_recordset(v_conds) as x(ord integer, type text, clause_id uuid, points_to uuid)
          where x.clause_id = v_cid
        ) then
          raise sqlstate 'LC001' using message = 'Is one of this test''s conditions the same statement as its consequence?';
        end if;
        if (select count(x.clause_id) <> count(distinct x.clause_id) or count(*) <> count(distinct x.ord)
            from jsonb_to_recordset(v_conds) as x(ord integer, type text, clause_id uuid, points_to uuid)) then
          raise sqlstate 'LC001' using message = 'Does a statement, or a position, appear twice among one test''s conditions?';
        end if;

        select coalesce(jsonb_agg(jsonb_build_array(x.type, x.clause_id, x.points_to)
                                  order by x.type, x.clause_id::text, x.points_to::text), '[]'::jsonb)
        into v_key
        from jsonb_to_recordset(v_conds) as x(ord integer, type text, clause_id uuid, points_to uuid);

        v_test_id := null;
        select t.test_id into v_test_id
        from legal_commons.test t
        where t.consequence_clause_id = v_cid
          and t.retired_at is null
          and (select coalesce(jsonb_agg(jsonb_build_array(tc.clause_type, tc.clause_id, tc.points_to_test_id)
                                         order by tc.clause_type, tc.clause_id::text, tc.points_to_test_id::text), '[]'::jsonb)
               from legal_commons.test_clause tc
               where tc.test_id = t.test_id) = v_key
        order by t.created_at, t.test_id
        limit 1;

        if v_test_id is null then
          insert into legal_commons.test (consequence_clause_id, contributor)
          values (v_cid, p_contributor)
          returning test_id into v_test_id;

          insert into legal_commons.test_clause (test_id, clause_order, clause_type, clause_id, points_to_test_id)
          select v_test_id, x.ord, x.type, x.clause_id, x.points_to
          from jsonb_to_recordset(v_conds) as x(ord integer, type text, clause_id uuid, points_to uuid);

          v_made := v_made + 1;
        end if;

        insert into legal_commons.test_principle (test_id, principle_id, principle_text_md5)
        values (v_test_id, v_principle_id, v_md5)
        on conflict (test_id, principle_id) do update set principle_text_md5 = excluded.principle_text_md5;

        v_ids := v_ids || jsonb_build_object(v_test->>'ref', v_test_id);
        v_progress := true;
      end loop;

      if not v_progress then
        raise sqlstate 'LC001' using message = 'Does a chain of exceptions in this decomposition lead back to the test it started from?';
      end if;
    end loop;

    -- The rationales.
    for v_rat in select r.value from jsonb_array_elements(coalesce(p_payload->'rationales', '[]'::jsonb)) r loop
      if jsonb_array_length(coalesce(v_rat->'tests', '[]'::jsonb)) = 0 then
        raise sqlstate 'LC001' using message = 'Which test does each rationale explain?';
      end if;
      if exists (
        select 1 from jsonb_array_elements_text(v_rat->'tests') r where not v_ids ? r.value
      ) then
        raise sqlstate 'LC001' using message = 'Does every rationale name tests that are in this decomposition?';
      end if;

      insert into legal_commons.test_rationale (test_id, clause_id, principle_id)
      select (v_ids->>r.value)::uuid, k.clause_id, v_principle_id
      from jsonb_array_elements_text(v_rat->'tests') r
      join legal_commons.clause k on k.text_key = legal_commons.tidy_clause_text(v_rat->>'text')
      on conflict do nothing;
    end loop;

    -- What became of each old row.
    for v_conv in select r.value from jsonb_array_elements(coalesce(p_payload->'conversion', '[]'::jsonb)) r loop
      v_crit := (v_conv->>'criterion_id')::uuid;
      if v_crit is not null and not exists (
        select 1 from legal_commons.criterion c
        where c.criterion_id = v_crit and c.principle_id = v_principle_id
      ) then
        raise sqlstate 'LC001' using message = 'Does each old condition named in the conversion record belong to this principle?';
      end if;

      v_conv_test := null;
      if v_conv->>'test' is not null then
        if not v_ids ? (v_conv->>'test') then
          raise sqlstate 'LC001' using message = 'Does each conversion record name a test that is in this decomposition?';
        end if;
        v_conv_test := (v_ids->>(v_conv->>'test'))::uuid;
      end if;

      v_conv_clause := null;
      if v_conv->>'clause_text' is not null then
        select k.clause_id into v_conv_clause
        from legal_commons.clause k
        where k.text_key = legal_commons.tidy_clause_text(v_conv->>'clause_text');
        if v_conv_clause is null then
          raise sqlstate 'LC001' using message = 'Is the wording each conversion record points at a statement in this decomposition?';
        end if;
      end if;

      v_reason := nullif(btrim(v_conv->>'reason'), '');
      if num_nonnulls(v_conv_test, v_conv_clause, v_reason) = 0 then
        raise sqlstate 'LC001' using message = 'What became of each old row: a test, a statement, or a reason for neither?';
      end if;

      insert into legal_commons.conversion_record (principle_id, criterion_id, test_id, clause_id, reason)
      select v_principle_id, v_crit, v_conv_test, v_conv_clause, v_reason
      where not exists (
        select 1 from legal_commons.conversion_record r
        where r.principle_id = v_principle_id
          and r.criterion_id is not distinct from v_crit
          and r.test_id is not distinct from v_conv_test
          and r.clause_id is not distinct from v_conv_clause
          and r.reason is not distinct from v_reason);
    end loop;
  exception
    when sqlstate 'LC001' then
      return jsonb_build_object('saved', false, 'question', sqlerrm);
    when data_exception then
      return jsonb_build_object('saved', false, 'question',
        'Is every id, number and yes-or-no value in this decomposition written in its proper form?');
  end;

  return jsonb_build_object(
    'saved', true,
    'principle_id', v_principle_id,
    'tests', v_ids,
    'tests_made', v_made
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- contribute_verdicts: stores verdicts, putting each pair in its one form
-- (clause_a the smaller id, the two directions swapped with it). All or none.
-- Each element: { "clause_a", "clause_b", "a_implies_b", "b_implies_a",
--                 "judge_kind": "person" | "model", "judge_model", "judge_prompt_version" }
-- -----------------------------------------------------------------------------
create or replace function legal_commons.contribute_verdicts(p_verdicts jsonb, p_contributor text)
returns jsonb
language plpgsql
set search_path = legal_commons, extensions
as $$
declare
  v jsonb;
  v_a uuid;
  v_b uuid;
  v_ab boolean;
  v_ba boolean;
  v_kind text;
  v_count integer := 0;
begin
  begin
    if (case when jsonb_typeof(p_verdicts) = 'array' then jsonb_array_length(p_verdicts) else 0 end) = 0 then
      raise sqlstate 'LC001' using message = 'Which pairs of statements were judged?';
    end if;

    for v in select r.value from jsonb_array_elements(p_verdicts) r loop
      v_a := (v->>'clause_a')::uuid;
      v_b := (v->>'clause_b')::uuid;
      v_ab := (v->>'a_implies_b')::boolean;
      v_ba := (v->>'b_implies_a')::boolean;
      v_kind := v->>'judge_kind';

      if v_a is null or v_b is null or v_a = v_b then
        raise sqlstate 'LC001' using message = 'Does each verdict name two different statements?';
      end if;
      if (select count(*) from legal_commons.clause c where c.clause_id in (v_a, v_b)) <> 2 then
        raise sqlstate 'LC001' using message = 'Are both statements of each verdict in the pool?';
      end if;
      if v_ab is null or v_ba is null then
        raise sqlstate 'LC001' using message = 'Does each verdict say, for both directions, whether one statement implies the other?';
      end if;
      if v_kind is null or v_kind not in ('person', 'model') then
        raise sqlstate 'LC001' using message = 'Was each verdict given by a person or by a model?';
      end if;
      if v_kind = 'model' and (v->>'judge_model' is null or v->>'judge_prompt_version' is null) then
        raise sqlstate 'LC001' using message = 'Which model, and which version of its instructions, gave each model verdict?';
      end if;

      insert into legal_commons.meaning_verdict
        (clause_a, clause_b, a_implies_b, b_implies_a, judge_kind, judge_model, judge_prompt_version, contributor)
      values (
        least(v_a, v_b), greatest(v_a, v_b),
        case when v_a < v_b then v_ab else v_ba end,
        case when v_a < v_b then v_ba else v_ab end,
        v_kind, v->>'judge_model', v->>'judge_prompt_version', p_contributor
      );
      v_count := v_count + 1;
    end loop;
  exception
    when sqlstate 'LC001' then
      return jsonb_build_object('saved', false, 'question', sqlerrm);
    when data_exception then
      return jsonb_build_object('saved', false, 'question',
        'Is every id and every yes-or-no value in these verdicts written in its proper form?');
  end;

  return jsonb_build_object('saved', true, 'verdicts', v_count);
end;
$$;

-- -----------------------------------------------------------------------------
-- retire: sets the retired date on a test or a verdict. Deletes nothing.
-- -----------------------------------------------------------------------------
create or replace function legal_commons.retire(p_kind text, p_id uuid, p_note text, p_contributor text)
returns jsonb
language plpgsql
set search_path = legal_commons, extensions
as $$
begin
  if p_kind = 'test' then
    update legal_commons.test
    set retired_at = now(), retired_by = p_contributor, retired_note = p_note
    where test_id = p_id and retired_at is null;
  elsif p_kind = 'verdict' then
    update legal_commons.meaning_verdict
    set retired_at = now(), retired_by = p_contributor, retired_note = p_note
    where verdict_id = p_id and retired_at is null;
  else
    return jsonb_build_object('saved', false, 'question', 'Is the thing to retire a test or a verdict?');
  end if;

  if not found then
    return jsonb_build_object('saved', false, 'question', 'Is this item in the pool and not yet retired?');
  end if;
  return jsonb_build_object('saved', true, 'kind', p_kind, 'id', p_id);
end;
$$;

-- -----------------------------------------------------------------------------
-- stage_clause_embeddings: holds one batch of new embeddings for a change of
-- model, without touching the embeddings the search reads. A change of model
-- arrives in batches because one Edge Function request cannot embed a whole
-- pool. Each staged row keeps the fingerprint its batch came with. Staging a
-- clause again replaces what was staged for it.
--   p_rows:        [ { "clause_id", "embedding": [384 numbers] } ]
--   p_fingerprint: [384 numbers]      -- fresh embedding of the fixed sentence
-- -----------------------------------------------------------------------------
create or replace function legal_commons.stage_clause_embeddings(p_rows jsonb, p_fingerprint jsonb)
returns jsonb
language plpgsql
set search_path = legal_commons, extensions
as $$
declare
  v_count integer;
begin
  if (case when jsonb_typeof(p_fingerprint) = 'array' then jsonb_array_length(p_fingerprint) else 0 end) <> 384 then
    return jsonb_build_object('saved', false, 'question',
      'Did this batch come with the embedding model''s fresh embedding of the fixed sentence?');
  end if;
  if (case when jsonb_typeof(p_rows) = 'array' then jsonb_array_length(p_rows) else 0 end) = 0 then
    return jsonb_build_object('saved', false, 'question', 'Which statements does this batch carry new embeddings for?');
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_rows) r
    where r.value->>'clause_id' is null
       or (case when jsonb_typeof(r.value->'embedding') = 'array'
                then jsonb_array_length(r.value->'embedding') else 0 end) <> 384
  ) then
    return jsonb_build_object('saved', false, 'question',
      'Does every row name a statement and carry its embedding?');
  end if;

  begin
    if exists (
      select 1 from jsonb_array_elements(p_rows) r
      where not exists (
        select 1 from legal_commons.clause c where c.clause_id = (r.value->>'clause_id')::uuid)
    ) then
      return jsonb_build_object('saved', false, 'question', 'Is every statement named in this batch in the pool?');
    end if;

    insert into legal_commons.clause_embedding_staging (clause_id, embedding, fingerprint)
    select distinct on ((r.value->>'clause_id')::uuid)
           (r.value->>'clause_id')::uuid,
           (r.value->'embedding')::text::extensions.vector,
           p_fingerprint::text::extensions.vector
    from jsonb_array_elements(p_rows) r
    order by (r.value->>'clause_id')::uuid
    on conflict (clause_id) do update set
      embedding = excluded.embedding,
      fingerprint = excluded.fingerprint,
      created_at = now();
    get diagnostics v_count = row_count;
  exception when data_exception then
    return jsonb_build_object('saved', false, 'question',
      'Is every id and every number in this batch written in its proper form?');
  end;

  return jsonb_build_object('saved', true, 'staged', v_count);
end;
$$;

-- -----------------------------------------------------------------------------
-- set_clause_embeddings: replaces every clause's embedding and the fingerprint
-- together, from the staged rows, for a change of model. It also stores the
-- first fingerprint while the pool has no clause. All or none: it refuses while
-- any clause has no staged embedding, or while any staged embedding came with a
-- fingerprint other than the one given, because embeddings from two models
-- under one fingerprint would return wrong neighbours without saying so.
--   p_fingerprint: { "model", "sentence", "embedding": [384 numbers] }
-- -----------------------------------------------------------------------------
create or replace function legal_commons.set_clause_embeddings(p_fingerprint jsonb)
returns jsonb
language plpgsql
set search_path = legal_commons, extensions
as $$
declare
  v_new extensions.vector;
  v_count integer;
begin
  -- No clause may arrive between the completeness check and the update.
  lock table legal_commons.clause in share row exclusive mode;

  if coalesce(p_fingerprint->>'model', '') = ''
     or coalesce(p_fingerprint->>'sentence', '') = ''
     or (case when jsonb_typeof(p_fingerprint->'embedding') = 'array'
              then jsonb_array_length(p_fingerprint->'embedding') else 0 end) <> 384 then
    return jsonb_build_object('saved', false, 'question',
      'Does the fingerprint name the model, the fixed sentence and that sentence''s embedding?');
  end if;
  begin
    v_new := (p_fingerprint->'embedding')::text::extensions.vector;
  exception when data_exception then
    return jsonb_build_object('saved', false, 'question',
      'Is every number in the fingerprint written in its proper form?');
  end;

  if exists (
    select 1 from legal_commons.clause c
    where not exists (
      select 1 from legal_commons.clause_embedding_staging s where s.clause_id = c.clause_id)
  ) then
    return jsonb_build_object('saved', false, 'question',
      'Has a new embedding been staged for every statement in the pool?');
  end if;
  if exists (
    select 1 from legal_commons.clause_embedding_staging s
    where 1 - (s.fingerprint <=> v_new) < 0.999
  ) then
    return jsonb_build_object('saved', false, 'question',
      'Were all the staged embeddings made by the model this fingerprint names?');
  end if;

  update legal_commons.clause c
  set embedding = s.embedding
  from legal_commons.clause_embedding_staging s
  where c.clause_id = s.clause_id;
  get diagnostics v_count = row_count;

  -- `where true`: Supabase refuses a delete with no condition from an API role.
  delete from legal_commons.clause_embedding_staging where true;

  insert into legal_commons.embedding_fingerprint (only_row, model, sentence, embedding)
  values (true, p_fingerprint->>'model', p_fingerprint->>'sentence', v_new)
  on conflict (only_row) do update set
    model = excluded.model,
    sentence = excluded.sentence,
    embedding = excluded.embedding,
    updated_at = now();

  return jsonb_build_object('saved', true, 'clauses', v_count, 'model', p_fingerprint->>'model');
end;
$$;

-- -----------------------------------------------------------------------------
-- Grants: service_role only. A function is executable by every role unless that
-- default is withdrawn, so it is withdrawn here.
-- -----------------------------------------------------------------------------
revoke execute on function legal_commons.clause_search(text, extensions.vector, text, integer) from public;
revoke execute on function legal_commons.contribute_decomposition(jsonb, text) from public;
revoke execute on function legal_commons.contribute_verdicts(jsonb, text) from public;
revoke execute on function legal_commons.retire(text, uuid, text, text) from public;
revoke execute on function legal_commons.stage_clause_embeddings(jsonb, jsonb) from public;
revoke execute on function legal_commons.set_clause_embeddings(jsonb) from public;
grant execute on function legal_commons.clause_search(text, extensions.vector, text, integer) to service_role;
grant execute on function legal_commons.contribute_decomposition(jsonb, text) to service_role;
grant execute on function legal_commons.contribute_verdicts(jsonb, text) to service_role;
grant execute on function legal_commons.retire(text, uuid, text, text) to service_role;
grant execute on function legal_commons.stage_clause_embeddings(jsonb, jsonb) to service_role;
grant execute on function legal_commons.set_clause_embeddings(jsonb) to service_role;
notify pgrst, 'reload schema';
